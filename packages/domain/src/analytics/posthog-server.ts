import {PostHog} from 'posthog-node'
import {z} from 'zod'

const PostHogEnv = z.object({
  POSTHOG_PROJECT_API_KEY: z.string().regex(/^phc_/),
  POSTHOG_HOST: z.string().url().default('https://us.i.posthog.com'),
})

export const createPosthog = () => {
  const env = PostHogEnv.parse(process.env)
  return new PostHog(env.POSTHOG_PROJECT_API_KEY, {host: env.POSTHOG_HOST})
}

export const captureServerEvent: PostHog['capture'] = (...args) => {
  const posthog = createPosthog()
  posthog.capture(...args)
  void posthog.shutdown(25_000)
}
