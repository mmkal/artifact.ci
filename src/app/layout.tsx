import '../styles/globals.css'

import type {Metadata} from 'next'
import {Inter} from 'next/font/google'
import {Suspense} from 'react'
import {emoji, productionUrl} from '../site-config'
import {PostHogPageview} from '~/analytics/posthog-client'

// https://github.com/vercel/next.js/blob/f6afb0e09e3d149d0b3216cb199f14994698df21/packages/next/src/compiled/node-fetch/index.js requires `punycode` which is deprecated
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
      <Suspense fallback={null}>
        <PostHogPageview />
      </Suspense>
      <body className={inter.className}>{children}</body>
    </html>
  )
}
