export const getLogger = ({debug = false}) => ({
  info: (...args: unknown[]) => console.info(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
  debug: (...args: unknown[]) => (debug ? console.info(...args) : void 0),
})
