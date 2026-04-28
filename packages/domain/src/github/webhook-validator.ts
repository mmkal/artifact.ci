import {Webhooks} from '@octokit/webhooks'
import {z} from 'zod'
import {logger} from '../logging/tag-logger'

export const WebhookEnv = z.object({
  GITHUB_APP_WEBHOOK_SECRET: z.string(),
})

export const validateGithubWebhook = async (signature: string | null | undefined, body: string) => {
  const webhookEnv = WebhookEnv.parse(process.env)
  const webhooks = new Webhooks({secret: webhookEnv.GITHUB_APP_WEBHOOK_SECRET})
  logger.debug('validating webhook', {signature, secretLength: webhookEnv.GITHUB_APP_WEBHOOK_SECRET.length})
  return webhooks.verify(body, signature || '')
}
