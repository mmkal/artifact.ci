import {getAppEnv} from '../cloudflare-env'

export function getArtifactOrigin(request: Request) {
  const env = getAppEnv()
  return env.PUBLIC_DEV_URL || env.BETTER_AUTH_URL || new URL(request.url).origin
}
