import {handle} from '@astrojs/cloudflare/handler'

export default {
  async fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> {
    return handle(request, env, ctx)
  },
}
