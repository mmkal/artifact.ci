import {DocsThemeConfig} from 'nextra-theme-docs'
import React from 'react'
import {githubUrl, productionUrl, twitterUrl} from './src/site-config'

const config: DocsThemeConfig = {
  logo: <span>{productionUrl.hostname}</span>,
  project: {
    link: githubUrl.href,
  },
  chat: {
    link: twitterUrl.href,
    // eslint-disable-next-line @next/next/no-img-element
    icon: <img width={20} height={20} src="/x-logo/logo.svg" alt="mmkal on X" />,
  },
  docsRepositoryBase: githubUrl.href + '/tree/main/src/pages',
  footer: {
    text: productionUrl.hostname,
  },
}

export default config
