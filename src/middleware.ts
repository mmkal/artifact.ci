import {checkContext} from './analytics/posthog-server'

export default function middleware() {
  checkContext('middleware')
}
