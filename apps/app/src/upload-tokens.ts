import {type AsyncClient} from 'sqlfu'

const tokenTtlMs = 10 * 60 * 1000

export const createUploadToken = async (db: AsyncClient, githubLogin: string) => {
  const token = randomHex(32)
  const now = Date.now()
  await db.sql.run`delete from upload_tokens where expires_at < ${now}`
  await db.sql.run`
    insert into upload_tokens (token_hash, github_login, created_at, expires_at)
    values (${await hashUploadToken(token)}, ${githubLogin}, ${now}, ${now + tokenTtlMs})
  `
  return token
}

export const lookupUploadToken = async (db: AsyncClient, token: string) => {
  const now = Date.now()
  await db.sql.run`delete from upload_tokens where expires_at < ${now}`
  const rows = await db.sql.all<{github_login: string}>`
    select github_login
    from upload_tokens
    where token_hash = ${await hashUploadToken(token)}
      and expires_at > ${now}
    limit 1
  `
  return rows[0]?.github_login || null
}

const hashUploadToken = async (token: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return toHex(new Uint8Array(bytes))
}

const randomHex = (byteLength: number) => {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return toHex(bytes)
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
