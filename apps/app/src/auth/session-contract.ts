export interface AppSessionUser {
  id: string
  githubLogin: string | null
}

export interface AppSessionSnapshot {
  user: AppSessionUser | null
  source: 'better-auth'
}

export const emptySession: AppSessionSnapshot = {
  user: null,
  source: 'better-auth',
}
