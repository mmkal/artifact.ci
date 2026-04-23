import {App} from 'octokit'
import {z} from 'zod'

export const GithubAppEnv = z.object({
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1),
})

export const getOctokitApp = () => {
  const env = GithubAppEnv.parse(process.env)
  return new App({appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY})
}

export const getInstallationOctokit = async (installationId: number) => {
  const app = getOctokitApp()
  return app.getInstallationOctokit(installationId)
}

/**
 * Looks up the app installation for a given owner/repo via a raw JWT-auth
 * call. octokit's App.octokit auto-switches to installation auth for
 * `/repos/*` paths, which fails for the one endpoint where we actually want
 * app-JWT auth.
 */
export const lookupRepoInstallation = async (owner: string, repo: string): Promise<{id: number} | null> => {
  const env = GithubAppEnv.parse(process.env)
  const jwt = await makeAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY)
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/installation`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${jwt}`,
      'x-github-api-version': '2022-11-28',
    },
  })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`lookupRepoInstallation ${owner}/${repo} failed: ${response.status} ${await response.text()}`)
  }
  const payload = (await response.json()) as {id: number}
  return {id: payload.id}
}

async function makeAppJwt(appId: string, privateKey: string) {
  const {createSign} = await import('node:crypto')
  const now = Math.floor(Date.now() / 1000)
  const header = {alg: 'RS256', typ: 'JWT'}
  const payload = {iat: now - 60, exp: now + 9 * 60, iss: appId}
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const signingInput = `${encode(header)}.${encode(payload)}`
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey).toString('base64url')
  return `${signingInput}.${signature}`
}
