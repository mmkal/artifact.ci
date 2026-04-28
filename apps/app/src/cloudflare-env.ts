import {AsyncLocalStorage} from 'node:async_hooks'
import {createD1Client, type AsyncClient, type D1DatabaseLike} from 'sqlfu'

export interface D1Result<T = Record<string, unknown>> {
  results: T[]
  meta: {
    changes?: number
    last_row_id?: number | string
  }
  success: boolean
}

export interface D1PreparedStatementBinding {
  bind(...values: unknown[]): D1PreparedStatementBinding
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>
  run(): Promise<D1Result>
}

export interface D1DatabaseBinding extends D1DatabaseLike {
  prepare(query: string): D1PreparedStatementBinding
  batch<T = Record<string, unknown>>(statements: D1PreparedStatementBinding[]): Promise<Array<D1Result<T>>>
  exec(sql: string): Promise<unknown>
}

export interface R2ObjectBody {
  body: ReadableStream | null
  httpEtag?: string
  writeHttpMetadata?(headers: Headers): void
}

export interface R2BucketBinding {
  get(key: string): Promise<R2ObjectBody | null>
  delete(key: string): Promise<void>
}

export interface AppEnv {
  ARTIFACT_DB: D1DatabaseBinding
  ARTIFACT_BLOBS: R2BucketBinding
  ARTIFACT_BLOBS_BUCKET: string
  CLOUDFLARE_ACCOUNT_ID: string
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  AUTH_URL: string
  AUTH_SECRET: string
  GITHUB_APP_ID: string
  GITHUB_APP_PRIVATE_KEY: string
  GITHUB_APP_CLIENT_ID: string
  GITHUB_APP_CLIENT_SECRET: string
  GITHUB_APP_WEBHOOK_SECRET: string
  POSTHOG_PROJECT_API_KEY: string
  POSTHOG_HOST: string
  PUBLIC_DEV_URL: string
}

const envStorage = new AsyncLocalStorage<AppEnv>()

export const runWithAppEnv = <T>(env: AppEnv, fn: () => T | Promise<T>) => envStorage.run(env, fn)

export const getAppEnv = () => {
  const env = envStorage.getStore()
  if (!env) throw new Error('Cloudflare env is not available for this request')
  return env
}

export const getDb = (): AsyncClient<D1DatabaseLike> => createD1Client(getAppEnv().ARTIFACT_DB)

export const parseJsonStringArray = (value: string | null): string[] => (value ? JSON.parse(value) : [])
