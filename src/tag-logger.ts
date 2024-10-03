import {AsyncLocalStorage} from 'async_hooks'

export class TagLogger {
  _storage = new AsyncLocalStorage<{
    tags: string[]
    logs: Array<{prefix: string; args: unknown[]}>
  }>()

  constructor(readonly _implementation = console as Pick<typeof console, 'info' | 'warn' | 'error' | 'debug'>) {}

  get context() {
    return this._storage.getStore() || {tags: [], logs: []}
  }

  get tags() {
    return this.context.tags
  }

  get prefix() {
    if (this.tags.length === 0) return []
    return [this.tags.map(c => `[${c}]`).join('')]
  }

  async run<T>(tag: string, fn: () => Promise<T>) {
    return this._storage.run({...this.context, tags: this.context.tags.concat(tag)}, fn)
  }

  info(...args: unknown[]) {
    this._implementation.info(...this.prefix, ...args)
  }

  warn(...args: unknown[]) {
    this._implementation.warn(...this.prefix, ...args)
  }

  error(...args: unknown[]) {
    this._implementation.error(...this.prefix, ...args)
  }

  debug(..._args: unknown[]) {
    // this._implementation.debug(...this.prefix, ...args)
  }
}

export const logger = new TagLogger()
