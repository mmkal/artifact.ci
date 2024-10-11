import {useRouter} from 'next/router'
import {DocsThemeConfig} from 'nextra-theme-docs'
import React from 'react'
import {emoji, githubUrl, productionUrl, twitterUrl} from './src/site-config'

const config: DocsThemeConfig = {
  logo: (
    <span>
      {emoji} {productionUrl.hostname}
    </span>
  ),
  useNextSeoProps() {
    const {asPath} = useRouter()
    const siteName = 'artifact.ci'
    return {
      titleTemplate: asPath === '/' ? siteName : `%s - ${siteName}`,
    }
  },
  project: {
    link: githubUrl.href,
  },
  chat: {
    link: twitterUrl.href,
    // eslint-disable-next-line @next/next/no-img-element
    icon: <img width={20} height={20} src="/x-logo/logo.svg" alt="mmkal on X" />,
  },
  docsRepositoryBase: githubUrl.href + '/tree/main/src/pages',
  head: () => (
    // https://www.jacobparis.com/content/use-an-emoji-favicon
    <link
      rel="icon"
      type="image/svg+xml"
      href={`data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>${emoji}</text></svg>`}
    />
  ),
  footer: {
    component: () => <div>{productionUrl.hostname}</div>,
  },
}

export default config
