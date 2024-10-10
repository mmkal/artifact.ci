import {z} from 'zod'
import {productionUrl} from '~/site-config'
import {logger} from '~/tag-logger'

// https://vercel.com/docs/projects/environment-variables/system-environment-variables#VERCEL_ENV
const VercelEnv = z.object({
  VERCEL_ENV: z.enum(['development', 'preview', 'production']),
  /** e.g. https://mywebsite.com */
  VERCEL_URL: z.string(),
  /** e.g. https://mywebsite-git-mybranch-myusername.vercel.app */
  VERCEL_BRANCH_URL: z.string().optional(),
})

let cachedOrigin: string | undefined

/** looks at (global) environment variables to determine the origin. right now just supports vercel envs and falls back to hardcoded `productionUrl.origin`. */
export const globalServerOrigin = () => {
  if (cachedOrigin) return cachedOrigin

  if (!process.env.VERCEL_ENV) {
    logger.warn('VERCEL_ENV is not set')
    return (cachedOrigin = productionUrl.origin)
  }

  const env = VercelEnv.parse(process.env)
  if (env.VERCEL_ENV === 'production') {
    return (cachedOrigin = productionUrl.origin)
  }

  if (!env.VERCEL_BRANCH_URL || !env.VERCEL_URL) {
    logger.warn('VERCEL_BRANCH_URL or VERCEL_URL is not set', {env})
  }

  return (cachedOrigin = `https://${env.VERCEL_BRANCH_URL || env.VERCEL_URL}`)
}
