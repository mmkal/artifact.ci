import {AsyncLocalStorage} from 'async_hooks'

export namespace TagLogger {
  export type Level = keyof typeof TagLogger.levels
  export type Context = {
    level: TagLogger.Level
    tags: string[]
    logs: Array<{level: TagLogger.Level; prefix: string[]; args: unknown[]}>
  }
}

export class TagLogger {
  static levels = {debug: 0, info: 1, warn: 2, error: 3} as const

  _storage = new AsyncLocalStorage<TagLogger.Context>()

  constructor(readonly _implementation = console as Pick<typeof console, TagLogger.Level>) {}

  get context(): TagLogger.Context {
    return this._storage.getStore() || {level: 'info', tags: [], logs: []}
  }

  get level() {
    return this.context.level
  }

  set level(level: TagLogger.Level) {
    if (!this._storage.getStore()) throw new Error(`You can't set the level globally. Use .run(...) to scope`)
    this.context.level = level
  }

  get levelNumber() {
    return TagLogger.levels[this.level]
  }

  get tags() {
    return this.context.tags
  }

  get prefix() {
    if (this.tags.length === 0) return []
    return [this.tags.map(c => `[${c}]`).join('')]
  }

  run<T>(tag: string, fn: () => T): T {
    return this._storage.run({...this.context, tags: this.context.tags.concat(tag)}, fn)
  }

  tag(tag: string) {
    return {
      info: (...args: unknown[]) => this.run(tag, () => this.info(...args)),
      warn: (...args: unknown[]) => this.run(tag, () => this.warn(...args)),
      error: (...args: unknown[]) => this.run(tag, () => this.error(...args)),
      debug: (...args: unknown[]) => this.run(tag, () => this.debug(...args)),
    }
  }

  _log({level, args, forget}: {level: TagLogger.Level; args: unknown[]; forget?: boolean}) {
    if (!forget) this.context.logs.push({level, prefix: this.prefix, args})

    if (this.levelNumber > TagLogger.levels[level]) return
    this._implementation[level](...this.prefix, ...args)
  }

  debug(...args: unknown[]) {
    this._log({level: 'debug', args})
  }

  info(...args: unknown[]) {
    this._log({level: 'info', args})
  }

  warn(...args: unknown[]) {
    this._log({level: 'warn', args})
  }

  error(...args: unknown[]) {
    this._log({level: 'error', args})
  }

  memories() {
    return this.context.logs.map(log => [log.level, ...log.prefix, ...log.args])
  }

  /** Like `.run(...)`, but if there is an error, it will log the "memories" of its context, including all log levels, even debug */
  try<T>(tag: string, fn: () => Promise<T>): Promise<T> {
    return this.run(tag, async () => {
      try {
        return await fn()
      } catch (error) {
        this.run('memories', () => this._log({level: 'error', args: [this.memories()], forget: true}))
        throw error
      }
    })
  }
}

export const logger = new TagLogger()
