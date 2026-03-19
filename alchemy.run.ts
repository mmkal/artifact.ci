import alchemy from 'alchemy'
import {Astro, TanStackStart, Worker} from 'alchemy/cloudflare'

const app = await alchemy('artifact-ci')

export const appWorker = await TanStackStart('app', {
  cwd: './apps/app',
  name: `${app.name}-${app.stage}-app`,
  entrypoint: 'dist/server/server.js',
  build: {
    command: 'vite build',
  },
  dev: {
    command: 'vite dev --host 127.0.0.1',
  },
})

export const docsWorker = await Astro('docs', {
  cwd: './apps/docs',
  name: `${app.name}-${app.stage}-docs`,
  output: 'static',
  build: {
    command: 'astro build',
  },
  dev: {
    command: 'astro dev --host 127.0.0.1',
  },
})

export const frontdoorWorker = await Worker('frontdoor', {
  name: `${app.name}-${app.stage}-frontdoor`,
  entrypoint: './apps/frontdoor/src/index.ts',
  compatibility: 'node',
  url: true,
  bindings: {
    APP: appWorker,
    DOCS: docsWorker,
    APP_URL: appWorker.url || '',
    DOCS_URL: docsWorker.url || '',
    SUPABASE_PROJECT_URL: process.env.SUPABASE_PROJECT_URL || '',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },
})

console.log({
  appUrl: appWorker.url,
  docsUrl: docsWorker.url,
  frontdoorUrl: frontdoorWorker.url,
})

await app.finalize()
