import {waitUntil} from '@vercel/functions'
import {PostHog} from 'posthog-node'
import {z} from 'zod'

const PostHogEnv = z.object({
  POSTHOG_PROJECT_API_KEY: z.string().regex(/^phc_/),
  POSTHOG_HOST: z.string().url().default('https://us.i.posthog.com'),
})

export const createPosthog = () => {
  const env = PostHogEnv.parse(process.env)
  return new PostHog(env.POSTHOG_PROJECT_API_KEY, {
    host: env.POSTHOG_HOST,
  })
}

export const captureServerEvent: PostHog['capture'] = (...args) => {
  const posthog = createPosthog()
  posthog.capture(...args)
  waitUntil(posthog.shutdown(25_000))
}

// waitUntil trust issues: https://github.com/vercel/next.js/issues/50522#issuecomment-2405676723
const SYMBOL_FOR_REQ_CONTEXT = Symbol.for('@vercel/request-context')
const warned = {} as Record<string, boolean>

export type VercelRequestContext = {
  waitUntil?: (promise: Promise<unknown>) => void
  url: string
  flags: {
    getValue: (flag: string) => string | undefined
    reportValue: (flag: string, value: string) => void
  }
  headers: Record<string, string>
}

/* eslint-disable */
export function vercelRequestContext(): VercelRequestContext {
  const fromSymbol = globalThis as any
  return fromSymbol[SYMBOL_FOR_REQ_CONTEXT]?.get?.() ?? {}
}
/* eslint-enable */

export function checkContext(key: string) {
  const reqCtx = vercelRequestContext()

  if (!warned[key]) {
    const debugInfo = {
      reqCtx,
      SYMBOL_FOR_REQ_CONTEXT: SYMBOL_FOR_REQ_CONTEXT.toString(),
      waitUntil: reqCtx?.waitUntil,
    }
    if (!debugInfo.waitUntil && process.env.NODE_ENV !== 'development') {
      console.error(key, 'waitUntil MISSING', debugInfo)
    }
    warned[key] = true
  }
  return reqCtx
}
