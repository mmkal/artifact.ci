import {useRouter} from 'next/router'
import {DocsThemeConfig, useConfig} from 'nextra-theme-docs'
import React from 'react'
import {emoji, githubUrl, productionUrl, twitterUrl} from './src/site-config'

const Head = () => {
  const {asPath} = useRouter()
  const config = useConfig()
  const siteName = productionUrl.hostname
  const pageTitle = asPath === '/' ? siteName : `${config.title} - ${siteName}`
  return (
    <>
      <meta property="og:title" content={pageTitle} />
      <meta
        property="og:description"
        content={(config.frontMatter.description as string) || `View GitHub artifacts in your browser`}
      />
      <title>{pageTitle}</title>
      <link
        // https://www.jacobparis.com/content/use-an-emoji-favicon
        rel="icon"
        type="image/svg+xml"
        href={`data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>${emoji}</text></svg>`}
      />
    </>
  )
}

const config: DocsThemeConfig = {
  logo: (
    <span>
      {emoji} {productionUrl.hostname}
    </span>
  ),
  head: Head,
  footer: {
    component: () => <div>{productionUrl.hostname}</div>,
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
  navbar: {
    extraContent: <a href="/artifact/view">{emoji}</a>,
  },
}

export default config
