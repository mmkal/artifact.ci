import type {Metadata} from 'next'
import {Inter} from 'next/font/google'
import {emoji, productionUrl} from '../site-config'

import '../styles/globals.css'

const inter = Inter({subsets: ['latin']})

export const metadata: Metadata = {
  title: productionUrl.hostname,
  description: 'Artifact Browser by @mmkal',
}

export default function RootLayout({children}: {children: React.ReactNode}): JSX.Element {
  return (
    <html lang="en">
      <head>
        <link
          rel="icon"
          href={`data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>${emoji}</text></svg>`}
        />
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  )
}
