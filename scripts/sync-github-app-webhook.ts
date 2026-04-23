#!/usr/bin/env tsx
/**
 * Point the artifact.ci GitHub App's webhook URL at our local dev tunnel,
 * so that workflow_job / installation events during dev hit the laptop.
 *
 * Reads the tunnel URL from the first CLI arg (or `.alchemy/tunnel-url.txt`)
 * and the app credentials from env (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`).
 * Calls `PATCH /app/hook/config` via the app's JWT — no user token needed.
 */
import 'dotenv/config'
import {readFile} from 'node:fs/promises'
import {App} from 'octokit'

async function main() {
  const argUrl = process.argv[2]
  const tunnelUrl =
    argUrl ||
    (await readFile(new URL('../.alchemy/tunnel-url.txt', import.meta.url), 'utf8')
      .then(s => s.trim())
      .catch(() => ''))

  if (!tunnelUrl) {
    console.error('usage: sync-github-app-webhook.ts <tunnel-url>')
    console.error('(or write the URL into .alchemy/tunnel-url.txt)')
    process.exit(1)
  }

  const appId = required('GITHUB_APP_ID')
  const privateKey = required('GITHUB_APP_PRIVATE_KEY')
  const app = new App({appId, privateKey})

  const webhookUrl = new URL('/github/events', tunnelUrl).toString()

  const {data: before} = await app.octokit.request('GET /app/hook/config')
  if (before.url === webhookUrl) {
    console.log(`[webhook-sync] already pointing at ${webhookUrl}`)
    return
  }

  await app.octokit.request('PATCH /app/hook/config', {url: webhookUrl})
  console.log(`[webhook-sync] ${before.url || '(none)'} -> ${webhookUrl}`)
}

function required(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`missing env var ${name}`)
  return value
}

main().catch(error => {
  console.error('[webhook-sync] failed:', error?.message || error)
  process.exit(1)
})
