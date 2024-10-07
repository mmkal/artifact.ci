// very good shim for require('path')
const path = {
  parse: (filepath: string) => {
    const pathParts = filepath.split('/')
    const base = pathParts.pop()!
    const fileParts = base.split('.')
    return {dir: pathParts.join('/'), base, name: fileParts.slice(0, -1).join('.'), ext: `.${fileParts.at(-1)}`}
  },
  join: (...paths: string[]) => paths.map(p => p.replace(/^\/$/, '').replace(/^\.\//, '')).join('/'),
}

export type Entrypoint = {path: string; shortened: string; score: number}

export const getEntrypoints = (pathnames: string[]) => {
  let entrypoints: Entrypoint[] = []

  const aliases = pathnames.flatMap(pathname => {
    const paths: string[] = []

    paths.push(pathname)

    const parsedPath = path.parse(pathname)
    if (parsedPath.base === 'index.html') {
      const score = 2 - pathname.length / 1_000_000
      const shortened = parsedPath.dir
      entrypoints.push({path: pathname, score, shortened})
      paths.push(shortened)
    }

    if (parsedPath.ext === '.html') {
      const score = 1 - pathname.length / 1_000_000
      const shortened = path.join(parsedPath.dir, parsedPath.name)
      entrypoints.push({path: pathname, score, shortened})
      paths.push(shortened)
    }

    return {original: pathname, paths}
  })

  const flatAliases = aliases.flatMap(a => a.paths)

  entrypoints = entrypoints.sort((a, b) => b.score - a.score)
  entrypoints = Object.values(Object.fromEntries(entrypoints.map(e => [e.path, e])))
  if (!entrypoints.length && pathnames.length > 0) {
    entrypoints.push({path: pathnames[0], shortened: pathnames[0], score: -1})
  }

  return {aliases, entrypoints, flatAliases}
}
