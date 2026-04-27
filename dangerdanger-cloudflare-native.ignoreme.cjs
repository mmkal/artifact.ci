/**
 * Applies the SQLite schema to the empty prod D1 database during the
 * Supabase -> Cloudflare-native cutover.
 *
 *   CONFIRM_CLOUDFLARE_NATIVE_CUTOVER=artifact-ci-prod-db \
 *     node --env-file=.env.prod dangerdanger-cloudflare-native.ignoreme.cjs
 *
 * This does not migrate Supabase data. Existing users sign in again and
 * recent artifacts lazy-rebuild from GitHub when viewed.
 */

const {spawnSync} = require('node:child_process')
const path = require('node:path')

const databaseName = process.env.ARTIFACT_D1_DATABASE_NAME || 'artifact-ci-prod-db'
const confirm = process.env.CONFIRM_CLOUDFLARE_NATIVE_CUTOVER

if (!databaseName.includes('prod')) {
  throw new Error(`Refusing to run: "${databaseName}" does not look like a prod D1 database name.`)
}

if (confirm !== databaseName) {
  throw new Error(`Set CONFIRM_CLOUDFLARE_NATIVE_CUTOVER=${databaseName} to apply definitions.sql.`)
}

const env = {
  ...process.env,
  CLOUDFLARE_PROFILE: process.env.CLOUDFLARE_PROFILE || 'mishagmail',
}

runWrangler([
  'd1',
  'execute',
  databaseName,
  '--remote',
  '--file',
  path.join(__dirname, 'definitions.sql'),
])

runWrangler([
  'd1',
  'execute',
  databaseName,
  '--remote',
  '--command',
  "select name from sqlite_master where type = 'table' order by name",
])

console.log('[danger] done.')

function runWrangler(args) {
  console.log(`[danger] pnpm exec wrangler ${args.join(' ')}`)
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    cwd: __dirname,
    env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`wrangler exited with status ${result.status}`)
  }
}
