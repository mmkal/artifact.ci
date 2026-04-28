import {z} from 'zod'

export type Id<T extends string> = string & {id_for?: T}

export const Id = <T extends string>(_brand: T) => z.string() as z.ZodType<Id<T>>

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

export const createPrefixedId = <T extends string>(prefix: T): Id<T> => {
  let value = ''
  while (value.length < 27) {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    for (const byte of bytes) {
      if (byte >= 248) continue
      value += alphabet[byte % alphabet.length]
      if (value.length === 27) break
    }
  }
  return `${prefix}_${value}` as Id<T>
}
