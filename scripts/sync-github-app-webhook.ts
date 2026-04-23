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
import {createSign} from 'node:crypto'

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
  const jwt = makeAppJwt(appId, privateKey)

  const webhookUrl = new URL('/github/events', tunnelUrl).toString()

  const before = await ghRequest('GET', '/app/hook/config', jwt)
  if (before.url === webhookUrl) {
    console.log(`[webhook-sync] already pointing at ${webhookUrl}`)
    return
  }

  await ghRequest('PATCH', '/app/hook/config', jwt, {url: webhookUrl})
  console.log(`[webhook-sync] ${before.url || '(none)'} -> ${webhookUrl}`)
}

function required(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`missing env var ${name}`)
  return value
}

function makeAppJwt(appId: string, privateKey: string) {
  const now = Math.floor(Date.now() / 1000)
  const header = {alg: 'RS256', typ: 'JWT'}
  const payload = {iat: now - 60, exp: now + 9 * 60, iss: appId}
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  const signingInput = `${encode(header)}.${encode(payload)}`
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey).toString('base64url')
  return `${signingInput}.${signature}`
}

async function ghRequest(method: string, path: string, jwt: string, body?: unknown) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${jwt}`,
      'x-github-api-version': '2022-11-28',
      ...(body ? {'content-type': 'application/json'} : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`GitHub ${method} ${path} failed: ${response.status} ${text}`)
  }
  return (await response.json()) as any
}

main().catch(error => {
  console.error('[webhook-sync] failed:', error?.message || error)
  process.exit(1)
})
