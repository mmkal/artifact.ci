import {source} from '~/lib/source'
import {DocsLayout} from 'fumadocs-ui/layouts/docs'
import type {ReactNode} from 'react'
import {emoji, productionUrl, githubUrl, twitterUrl} from '~/site-config'

export default function Layout({children}: {children: ReactNode}) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{
        title: (
          <>
            {emoji} {productionUrl.hostname}
          </>
        ),
        url: '/',
      }}
      links={[
        {
          icon: 'github',
          text: 'GitHub',
          url: githubUrl.href,
        },
        {
          text: 'Artifacts',
          url: '/artifact/view',
        },
      ]}
      sidebar={{
        defaultOpenLevel: 1,
      }}
    >
      {children}
    </DocsLayout>
  )
}
