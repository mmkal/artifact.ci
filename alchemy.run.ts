import {createPrivateKey} from 'node:crypto'

// Pin the Cloudflare account wrangler + alchemy talk to. Can be overridden
// in .env for deploys that need a different account.
process.env.CLOUDFLARE_PROFILE ||= 'mishagmail'

import alchemy from 'alchemy'
import {TanStackStart, Website, Worker} from 'alchemy/cloudflare'

const APP_DEV_PORT = 43111
const DOCS_DEV_PORT = 43112

const app = await alchemy('artifact-ci')

/**
 * workerd's bundled octokit ships universal-github-app-jwt, which only
 * accepts PKCS#8 private keys. GitHub Apps issue keys in PKCS#1 by default.
 * Node can round-trip them, so we normalise once here before binding.
 */
const normalizePrivateKey = (value: string | undefined) => {
  if (!value) return ''
  if (value.includes('BEGIN PRIVATE KEY')) return value
  return createPrivateKey({key: value, format: 'pem'})
    .export({format: 'pem', type: 'pkcs8'}) as string
}

const passthroughEnv = (names: string[]): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const name of names) {
    const raw = process.env[name] ?? ''
    out[name] = name === 'GITHUB_APP_PRIVATE_KEY' ? normalizePrivateKey(raw) : raw
  }
  return out
}

const appBindings = passthroughEnv([
  'DATABASE_URL',
  'PGKIT_CONNECTION_STRING',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'AUTH_URL',
  'AUTH_SECRET',
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_CLIENT_ID',
  'GITHUB_APP_CLIENT_SECRET',
  'GITHUB_APP_WEBHOOK_SECRET',
  'SUPABASE_PROJECT_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'POSTHOG_PROJECT_API_KEY',
  'POSTHOG_HOST',
  'PUBLIC_DEV_URL',
])

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
  bindings: appBindings,
})

export const docsWorker = await Website('docs', {
  cwd: './apps/docs',
  name: `${app.name}-${app.stage}-docs`,
  build: {
    command: 'astro build',
  },
  dev: {
    // -u so python flushes, 2>&1 so python's "Serving HTTP on …" banner lands
    // on stdout (alchemy's URL extractor reads stdout only), --bind so we get
    // an IPv4 address — the extractor's regex doesn't recognise [::] form.
    command: `sh -c "python3 -u -m http.server ${DOCS_DEV_PORT} -d dist --bind 127.0.0.1 2>&1"`,
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
