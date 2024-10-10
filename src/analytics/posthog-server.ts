import {PostHog} from 'posthog-node'
import {z} from 'zod'

const PostHogEnv = z.object({
  POSTHOG_PROJECT_API_KEY: z.string().regex(/^phc_/),
  POSTHOG_HOST: z.string().url().default('https://us.i.posthog.com'),
})

export const createPosthog = () => {
  const env = PostHogEnv.parse(process.env)
  const posthog = new PostHog(env.POSTHOG_PROJECT_API_KEY, {
    host: env.POSTHOG_HOST,
  })
  return Object.assign(posthog, {
    captureAsync: async (...args: Parameters<typeof posthog.capture>) => {
      checkContext('captureAsync')
      posthog.capture(...args)
      await posthog.shutdown(25_000)
    },
  })
}

/* eslint-disable */
// waitUntil trust issues: https://github.com/vercel/next.js/issues/50522#issuecomment-2405676723
const SYMBOL_FOR_REQ_CONTEXT = Symbol.for('@vercel/request-context')
const warned = {} as Record<string, boolean>
export function checkContext(key: string) {
  const fromSymbol = globalThis as any
  const reqCtx = (fromSymbol[SYMBOL_FOR_REQ_CONTEXT]?.get?.()) ?? {}

  if (!warned[key]) {
    const debugInfo = {
      reqCtx,
      SYMBOL_FOR_REQ_CONTEXT: SYMBOL_FOR_REQ_CONTEXT.toString(),
      [`globalThis.${SYMBOL_FOR_REQ_CONTEXT.toString()}`]: fromSymbol[SYMBOL_FOR_REQ_CONTEXT] || 'undefined',
      waitUntil: reqCtx?.waitUntil,
    }
    if (debugInfo.waitUntil) {
      console.warn(key, 'waitUntil EXISTS', debugInfo)
    } else {
      console.error(key, 'waitUntil MISSING', debugInfo)
    }

    warned[key] = true
  }
  return reqCtx
}
