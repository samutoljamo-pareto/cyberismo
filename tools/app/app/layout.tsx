import React from 'react'
import './globals.css'
import { Roboto } from 'next/font/google'

const roboto = Roboto({
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
  display: 'swap',
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={roboto.className}>
      <head><meta name="viewport" content="initial-scale=1, width=device-width" /></head>
      <body>{children}</body>
    </html>
  )
}
