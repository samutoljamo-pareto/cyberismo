import { expect } from 'chai';
import { dirname, join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';

import { copyDir } from '../src/utils/file-utils.js';
import { Project } from '../src/containers/project.js';
import { Edit } from '../src/edit.js';
import { fileURLToPath } from 'node:url';

describe('edit card', () => {
    const baseDir = dirname(fileURLToPath(import.meta.url));
    const testDir = join(baseDir, 'tmp-export-tests');

    before(async () => {
        mkdirSync(testDir, { recursive: true });
        await copyDir('test/test-data/', testDir);
    });

    after(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    it('edit card content (success)', async () => {
        const decisionRecordsPath = join(testDir, 'valid/decision-records');
        const project = new Project(decisionRecordsPath);
        const EditCmd = new Edit();
        const cards = await project.cards();
        const firstCard = cards.at(0);

        // Modify content
        if (firstCard) {
            const result = await EditCmd.editCardContent(project.basePath, firstCard.key, 'whoopie');
            expect(result.statusCode).to.equal(200);

            // Fetch the changed card again
            const changedCard = await project.findSpecificCard(firstCard.key, { metadata: true, content: true });
            if (changedCard) {
                expect(changedCard.content).to.equal('whoopie');
            } else {
                expect(false);
            }
        } else {
            expect(false);
        }
    });

    it('try to edit card content - no content', async () => {
        const decisionRecordsPath = join(testDir, 'valid/decision-records');
        const project = new Project(decisionRecordsPath);
        const EditCmd = new Edit();
        const cards = await project.cards();
        const firstCard = cards.at(0);
        if (firstCard) {
            const result = await EditCmd.editCardContent(project.basePath, firstCard.key, '');
            expect(result.statusCode).to.equal(400);
        }
    });

    it('try to edit card content - card is not in project', async () => {
        const decisionRecordsPath = join(testDir, 'valid/decision-records');
        const project = new Project(decisionRecordsPath);
        const EditCmd = new Edit();
        const result = await EditCmd.editCardContent(project.basePath, 'card-key-does-not-exist', 'whoopie');
        expect(result.statusCode).to.equal(400);
    });

    it('try to edit card from CLI - no project', async () => {
        const decisionRecordsPath = join(testDir, 'valid/decision-records');
        const project = new Project(decisionRecordsPath);
        const cards = await project.cards();
        const firstCard = cards.at(0);
        if (firstCard) {
            const EditCmd = new Edit();
            const result = await EditCmd.editCard(project.basePath, firstCard.key + 1);
            expect(result.statusCode).to.equal(400);
        }
    });
    // @todo: Make sinon fake/mock for user preferences
    // it('try to edit card from CLI (success)', async () => {
    //     const decisionRecordsPath = join(testDir, 'valid/decision-records');
    //     const project = new Project(decisionRecordsPath);
    //     const cards = await project.cards();
    //     const firstCard = cards.at(0);
    //     if (firstCard) {
    //         const EditCmd = new Edit();
    //         const result = await EditCmd.editCard(project.basePath, firstCard.key);
    //         expect(result.statusCode).to.equal(400);
    //     }
    // });

    it('edit card content (success)', async () => {
        const decisionRecordsPath = join(testDir, 'valid/decision-records');
        const project = new Project(decisionRecordsPath);
        const EditCmd = new Edit();
        const cards = await project.cards();
        const firstCard = cards.at(0);

        // Modify metadata - summary
        if (firstCard) {
            const result = await EditCmd.editCardMetadata(project.basePath, firstCard.key, 'summary', 'new name');
            expect(result.statusCode).to.equal(200);

            // Fetch the changed card again
            const changedCard = await project.findSpecificCard(firstCard.key, { metadata: true, content: true });
            if (changedCard) {
                if (changedCard.metadata) {
                    expect(changedCard.metadata.summary).to.equal('new name');
                }
            } else {
                expect(false);
            }
        } else {
            expect(false);
        }
    });
    it('try to edit card metadata - incorrect field name', async () => {
        const decisionRecordsPath = join(testDir, 'valid/decision-records');
        const project = new Project(decisionRecordsPath);
        const EditCmd = new Edit();
        const cards = await project.cards();
        const firstCard = cards.at(0);
        if (firstCard) {
            const result = await EditCmd.editCardMetadata(project.basePath, firstCard.key, '', '');
            expect(result.statusCode).to.equal(400);
        }
    });

    it('try to edit card metadata - card is not in project', async () => {
        const decisionRecordsPath = join(testDir, 'valid/decision-records');
        const project = new Project(decisionRecordsPath);
        const EditCmd = new Edit();
        const result = await EditCmd.editCardMetadata(project.basePath, 'card-key-does-not-exist', 'whoopie', 'whoopie');
        expect(result.statusCode).to.equal(400);
    });

});
