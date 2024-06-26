// node
import { basename, join, sep } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

// ismo
import { card } from './interfaces/project-interfaces.js';
import { deleteFile, pathExists } from './utils/file-utils.js';
import { Project } from './containers/project.js';
import { requestStatus } from './interfaces/request-status-interfaces.js';

// Parsed Clingo result.
interface ParseResult {
    cardKey: string;
    field: string;
    value: string | number;
}

// Class that calculates with logic program card / project level calculations.
export class Calculate {
    static project: Project;

    private logicBinaryName: string = 'clingo';
    private static baseLogicFileName: string = 'base.lp';
    private static cardTreeFileName: string = 'cardtree.lp';
    private static modulesFileName: string = 'modules.lp';
    private static mainLogicFileName: string = 'main.lp';
    private static commonDefinitions: string = `
%
% Common definitions for all Cards projects
%

% parent and ancestor
ancestor(A, C) :- parent(A, C), card(A), card(B).
ancestor(A, C) :- parent(A, B), ancestor (B, C), card(A), card(B), card(C).

% if the cardtype is given, then it's a card
card(C) :- field(C, "cardtype", _).

% the default fields are not calculated, so let's mark them as user fields.
userfield(Cardkey, "cardtype") :- field(Cardkey, "cardtype", Cardtype).
userfield(Cardkey, "summary") :- field(Cardkey, "cardtype", Cardtype).
userfield(Cardkey, "workflowState") :- field(Cardkey, "cardtype", Cardtype).

% if all values of a field are cardkeys, then the field is of type "cardkeys"
fieldtype(X, Field, "cardkeys") :- field(X, Field, _), card(Value) : field(X, Field, Value).

`;
    private static mainLogicFile: string = `
#include "base.lp".
#include "cardtree.lp".
#include "modules.lp".
`;

    constructor() { }

    // Write the base.lp that contains common definitions.
    private async generateBase(parentCard: card | undefined) {
        // When generating calculations for a specific module, do not generate common calculations.
        if (parentCard) {
            return;
        }
        const destinationFile = join(Calculate.project.calculationFolder, Calculate.baseLogicFileName);
        await writeFile(destinationFile, Calculate.commonDefinitions, { encoding: 'utf-8', flag: 'w' });
    }

    // Write the cardtree.lp that contain data from the selected card-tree.
    private async generateCardTree(parentCard: card | undefined) {
        const destinationFile = join(Calculate.project.calculationFolder, Calculate.cardTreeFileName);
        const destinationFileBase = join(Calculate.project.calculationFolder, 'cards');
        const promiseContainer = [];

        // Small helper to deduce parent path
        function parentPath(cardPath: string) {
            const pathParts = cardPath.split(sep);
            if (pathParts.at(pathParts.length - 2) === 'cardroot') {
                return '';
            } else {
                return pathParts.at(pathParts.length - 3);
            }
        }

        const cards = await this.getCards(parentCard);
        for (const card of cards) {
            let logicProgram = `\n% ${card.key}\n`;
            const parentsPath = parentPath(card.path);

            if (card.metadata) {
                for (const [field, value] of Object.entries(card.metadata)) {
                    if (field === "labels") {
                        for (const label of value as Array<string>) {
                            logicProgram += `label(${card.key}, "${label}").\n`;
                        }
                    } else {
                        logicProgram += `field(${card.key}, "${field}", "${value}").\n`;
                    }
                }
            }

            if (parentsPath !== undefined && parentsPath !== "") {
                logicProgram += `parent(${card.key}, ${parentsPath}).\n`;
            }

            // write card-specific logic program file
            const filename = join(destinationFileBase, card.key);
            const cardLogicFile = `${filename}.lp`;
            promiseContainer.push(writeFile(cardLogicFile, logicProgram, { encoding: 'utf-8', flag: 'w' }));
        }

        // Once card specific files have been done, write the cardtree.lp.
        const allCards = parentCard ? await Calculate.project.cards() : cards;
        let cardTreeContent: string = '';
        for (const card of allCards) {
            cardTreeContent += `#include "cards/${card.key}.lp".\n`;
        }
        promiseContainer.push(writeFile(destinationFile, cardTreeContent, { encoding: 'utf-8', flag: 'w' }));

        await Promise.all(promiseContainer);
    }

    // Write the main.lp that includes all other logic programs.
    private async generateMainLogicFile(parentCard: card | undefined) {
        // When generating calculations for a specific module, do not generate common calculations.
        if (parentCard) {
            return;
        }
        const destinationFile = join(Calculate.project.calculationFolder, Calculate.mainLogicFileName);
        await writeFile(destinationFile, Calculate.mainLogicFile, { encoding: 'utf-8', flag: 'w' });
    }

    // Collects all logic calculation files from project (local and imported modules)
    private async generateModules(parentCard: card | undefined) {
        // When generating calculations for a specific module, do not generate common calculations.
        if (parentCard) {
            return;
        }
        const destinationFile = join(Calculate.project.calculationFolder, Calculate.modulesFileName);
        let modulesContent: string = '';
        const calculations = await Calculate.project.calculations();

        // write the modules.lp
        for (const calculationFile of calculations) {
            if (calculationFile.path) {
                // modules resources are always prefixed with module name (to ensure uniqueness), remove module name
                const moduleLogicFile = join(calculationFile.path, basename(calculationFile.name));
                modulesContent += `#include "${moduleLogicFile}".\n`;
            }
        }
        await writeFile(destinationFile, modulesContent, { encoding: 'utf-8', flag: 'w' });
    }

    // Gets either all the cards (no parent), or a subtree.
    private async getCards(parentCard: card | undefined): Promise<card[]> {
        let cards: card[] = [];
        if (parentCard) {
            const card = await Calculate.project.findSpecificCard(
                parentCard.key,
                { metadata: true, children: true, content: false, parent: false }
            );
            if (card && card.children) {
                cards = Project.flattenCardArray(card.children);
            }
            if (card) {
                delete card.children;
                cards.unshift(card);
            }
        } else {
            cards = await Calculate.project.cards();
        }
        return cards;
    }

    // Checks that Clingo successfully returned result.
    private async parseClingoResult(data: string): Promise<ParseResult[] | undefined> {
        const actual_result = data.substring(0, data.indexOf('SATISFIABLE'));
        if (actual_result.length === 0 || !actual_result) {
            return;
        }
        const parseResult = this.parseInput(actual_result);
        return parseResult;
    }

    // Parses Clingo's result to an array of objects (key, field, value).
    private parseInput(input: string): ParseResult[] {
        const regex = /(field|fieldtype)\(([a-zA-Z0-9_]+),"([a-zA-Z0-9_]+)",([a-zA-Z0-9_" ]+)/;
        const results: ParseResult[] = []

        for (const datum of input.split('\n')) {
            if (datum) {
                const match = datum.match(regex);
                if (match) {
                    results.push({
                        cardKey: match[2],
                        field: match[3],
                        value: match[4]
                    });
                }
            }
        }
        return results;
    }

    // Creates a project, if it is not already created.
    private async setCalculateProject(card: card) {
        if (!Calculate.project) {
            const path = await Project.findProjectRoot(card.path);
            if (path) {
                Calculate.project = new Project(path);
            } else {
                throw `Card '${card.key}' not in project structure`;
            }
        }
    }

    /**
     * Generates a logic program.
     * @param {string} projectPath Path to a project
     * @param {string} cardKey Optional, sub-card tree defining card
     * @returns request status
     *       statusCode 200 when target was removed successfully
     *  <br> statusCode 400 when input validation failed
     */
    public async generate(projectPath: string, cardKey?: string): Promise<requestStatus> {
        Calculate.project = new Project(projectPath);

        let card: card | undefined;
        if (cardKey) {
            card = await Calculate.project.findSpecificCard(cardKey);
            if (!card) {
                return { statusCode: 400, message: `Card '${cardKey}' not found` };
            }
        }

        await mkdir(join(Calculate.project.calculationFolder, 'cards'), { recursive: true });

        // Calculation files are in their own files, so they can be generated parallel.
        const promiseContainer = [
            this.generateBase(card),
            this.generateCardTree(card),
            this.generateModules(card),
            this.generateMainLogicFile(card)
        ];

        await Promise.all(promiseContainer);
        return { statusCode: 200 };
    }

    /**
     * When card changes, update the card specific calculations.
     * @param {card} changedCard Card that was changed.
     * @returns request status:
     * - 'statusCode' 200 when template was created successfully
     * - 'statusCode' 400 when card was not part of the project
     */
    public async handleCardChanged(changedCard: card) {
        await this.setCalculateProject(changedCard); // can throw
        await this.generate(Calculate.project.basePath, changedCard.key);
        return { statusCode: 200 };
    }

    /**
     * When cards are removed, automatically remove card-specific calculations.
     * @param {card} deletedCard Card that is to be removed.
     * @param {Project} project Optional, project container to use. If not specified, a new one will be created.
     */
    public async handleDeleteCard(deletedCard: card) {
        if (!deletedCard) {
            return;
        }

        await this.setCalculateProject(deletedCard); // can throw
        const affectedCards = await this.getCards(deletedCard);
        const cardTreeFile = join(Calculate.project.calculationFolder, Calculate.cardTreeFileName);
        const calculationsForTreeExist = pathExists(cardTreeFile) && pathExists(Calculate.project.calculationFolder);

        let cardTreeContent = calculationsForTreeExist ? await readFile(cardTreeFile, 'utf-8') : '';
        for (const card of affectedCards) {
            // First, delete card specific files.
            const cardCalculationsFile = join(Calculate.project.calculationFolder, 'cards', `${card.key}.lp`);
            if (pathExists(cardCalculationsFile)) {
                await deleteFile(cardCalculationsFile);
            }
            // Then, delete rows from cardtree.lp.
            const removeRow = `#include "cards/${card.key}.lp".\n`;
            cardTreeContent = cardTreeContent.replace(removeRow, '');
        }
        if (calculationsForTreeExist) {
            await writeFile(cardTreeFile, cardTreeContent, 'utf-8');
        }
    }

    /**
    * When new cards are added, automatically calculate card-specific values.
    * @param {card[]} cards Added cards.
    */
    public async handleNewCards(cards: card[]) {
        if (!cards) {
            return
        }

        const firstCard = cards[0];
        await this.setCalculateProject(firstCard); // can throw
        const cardTreeFile = join(Calculate.project.calculationFolder, Calculate.cardTreeFileName);
        const calculationsForTreeExist = pathExists(cardTreeFile) && pathExists(Calculate.project.calculationFolder);
        if (!calculationsForTreeExist) {
            // No calculations done, ignore update.
            return;
        }

        const promiseContainer = [];
        for (const card of cards) {
            promiseContainer.push(this.generateCardTree(card));
        }
        await Promise.all(promiseContainer);
    }

    /**
     * Runs a logic program.
     * @param {string} projectPath Path to a project
     * @param {string} cardKey Optional, if missing the calculations are run for the whole cardtree.
     *                         If defined, calculates only subtree.
     * @returns request status
     *       statusCode 200 when target was removed successfully
     *  <br> statusCode 400 when input validation failed
     */
    public async run(projectPath: string, cardKey: string): Promise<requestStatus> {
        Calculate.project = new Project(projectPath);

        const card = await Calculate.project.findSpecificCard(cardKey);
        if (!card) {
            return { statusCode: 400, message: `Card '${cardKey}' not found` };
        }

        const text =
            `
            #show.
            #show field(Cardkey, Field, Value):
                field(Cardkey, Field, Value),
                Cardkey = ${card.key},
                not userfield(Cardkey, Field).
            #show fieldtype(Cardkey, Field, Fieldtype):
                fieldtype(Cardkey, Field, Fieldtype),
                Cardkey = ${card.key},
                not userfield(Cardkey, Field).`;
        const main = join(Calculate.project.calculationFolder, Calculate.mainLogicFileName);
        const clingo = spawnSync(this.logicBinaryName, ['-', '--outf=0', '--out-ifs=\\n', '-V0', `${main}`], { encoding: 'utf8', input: text });

        if (clingo.stdout) {
            const result = await this.parseClingoResult(clingo.stdout);
            return { statusCode: 200, payload: result };
        }

        if (clingo.stderr && clingo.status) {
            const code = clingo.status
            // clingo's exit codes are bitfields. todo: move these somewhere
            const clingo_process_exit = {
                E_UNKNOWN: 0,
                E_INTERRUPT: 1,
                E_SAT: 10,
                E_EXHAUST: 20,
                E_MEMORY: 33,
                E_ERROR: 65,
                E_NO_RUN: 128,
            };
            // "satisfied" && "exhaust" mean that everything was inspected and a solution was found.
            if (!((code & clingo_process_exit.E_SAT) && (code & clingo_process_exit.E_EXHAUST))) {
                if (code & clingo_process_exit.E_ERROR) {
                    console.error('Error');
                }
                if (code & clingo_process_exit.E_INTERRUPT) {
                    console.error('Interrupted');
                }
                if (code & clingo_process_exit.E_MEMORY) {
                    console.error('Out of memory');
                }
                if (code & clingo_process_exit.E_NO_RUN) {
                    console.error('Not run');
                }
                if (code & clingo_process_exit.E_UNKNOWN) {
                    console.error('Unknown error');
                }
            }
            return { statusCode: 400, message: 'Clingo error' };
        }
        return { statusCode: 500, message: 'Cannot find "Clingo". Please install "Clingo".\nIf using MacOs: "brew install clingo".\nIf using Windows: download sources and compile new version.\nIf using Linux: check if your distribution contains pre-built package. Otherwise download sources and compile.' };
    }
}