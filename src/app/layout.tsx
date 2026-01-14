import '../styles/globals.css'
import 'fumadocs-ui/style.css'

import type {Metadata} from 'next'
import {Inter} from 'next/font/google'
import {Suspense} from 'react'
import {emoji, productionUrl} from '../site-config'
import {PostHogPageview} from '~/analytics/posthog-client'
import {RootProvider} from 'fumadocs-ui/provider/next'

const inter = Inter({subsets: ['latin']})

export const metadata: Metadata = {
  title: productionUrl.hostname,
  description: 'Artifact Browser by @mmkal',
}

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          rel="icon"
          href={`data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>${emoji}</text></svg>`}
        />
      </head>
      <Suspense fallback={null}>
        <PostHogPageview />
      </Suspense>
      <body className={inter.className}>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  )
}
