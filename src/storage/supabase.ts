import {z} from 'zod'
import {createProxyClient} from '~/openapi/client'
import {paths} from '~/openapi/generated/supabase-storage'

const Env = z.object({
  SUPABASE_PROJECT_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
})

export const supabaseStorageServiceRoleClient = () => {
  const supabaseEnv = Env.parse(process.env)
  return createProxyClient<paths>().configure({
    baseUrl: `${supabaseEnv.SUPABASE_PROJECT_URL}/storage/v1`,
    headers: {
      apikey: supabaseEnv.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${supabaseEnv.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  })
}
