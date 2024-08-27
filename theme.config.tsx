import {DocsThemeConfig} from 'nextra-theme-docs'
import React from 'react'
import { githubUrl, productionUrl, twitterUrl } from './src/site-config'

const config: DocsThemeConfig = {
  logo: <span>{productionUrl.hostname}</span>,
  project: {
    link: githubUrl.href,
  },
  chat: {
    link: twitterUrl.href,
  },
  docsRepositoryBase: githubUrl.href + '/tree/main/src/pages',
  footer: {
    text: productionUrl.hostname,
  },
}

export default config
