import {createClient} from 'pgkit/client'
import config from '../pgkit.config'

export const client = createClient(config.client.connectionString)

export {sql} from 'pgkit/client'

/** Branded id column type */
export type Id<T extends string> = string & {id_for?: T}
