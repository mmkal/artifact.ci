import 'dotenv/config'
import {createServerAuth} from './apps/app/src/auth/server-auth'

export const auth = createServerAuth()

export default auth
