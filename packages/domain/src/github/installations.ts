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
