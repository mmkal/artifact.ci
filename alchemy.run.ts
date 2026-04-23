import alchemy from 'alchemy'
import {TanStackStart, Website, Worker} from 'alchemy/cloudflare'

const APP_DEV_PORT = 43111
const DOCS_DEV_PORT = 43112

const app = await alchemy('artifact-ci')

export const appWorker = await TanStackStart('app', {
  cwd: './apps/app',
  name: `${app.name}-${app.stage}-app`,
  entrypoint: 'dist/server/server.js',
  build: {
    command: 'vite build',
  },
  dev: {
    command: `vite dev --host 127.0.0.1 --port ${APP_DEV_PORT} --strictPort`,
  },
})

export const docsWorker = await Website('docs', {
  cwd: './apps/docs',
  name: `${app.name}-${app.stage}-docs`,
  build: {
    command: 'astro build',
  },
  dev: {
    // -u so python flushes, 2>&1 so the "Serving on 0.0.0.0:PORT" line alchemy
    // needs to latch onto reaches stdout instead of getting stuck on stderr.
    command: `sh -c "python3 -u -m http.server ${DOCS_DEV_PORT} -d dist 2>&1"`,
  },
  assets: 'dist',
})

export const frontdoorWorker = await Worker('frontdoor', {
  name: `${app.name}-${app.stage}-frontdoor`,
  entrypoint: './apps/frontdoor/src/index.ts',
  compatibility: 'node',
  url: true,
  bindings: {
    APP: appWorker,
    DOCS: docsWorker,
    APP_URL: appWorker.url || `http://127.0.0.1:${APP_DEV_PORT}`,
    DOCS_URL: docsWorker.url || `http://127.0.0.1:${DOCS_DEV_PORT}`,
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
