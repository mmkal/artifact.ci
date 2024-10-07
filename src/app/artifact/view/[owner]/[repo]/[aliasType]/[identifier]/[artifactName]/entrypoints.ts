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

export const getEntrypoints = (pathnames: string[], requestedEntrypoints: string[] = []) => {
  const bestEntrypoints = [{path: pathnames.at(0), shortened: pathnames.at(0), score: -1}]

  const aliases = pathnames.flatMap(pathname => {
    const paths: string[] = []

    paths.push(pathname)

    const parsedPath = path.parse(pathname)
    if (parsedPath.base === 'index.html') {
      const score = 2
      const shortened = parsedPath.dir
      bestEntrypoints.push({path: pathname, score, shortened})
      paths.push(shortened)
    }

    if (parsedPath.ext === '.html') {
      const score = 1
      const shortened = path.join(parsedPath.dir, parsedPath.name)
      bestEntrypoints.push({path: pathname, score, shortened})
      paths.push(shortened)
    }

    return {original: pathname, paths}
  })

  const flatAliases = aliases.flatMap(a => a.paths)
  const set = new Set(flatAliases)

  const entrypoints = requestedEntrypoints.filter(pathname => set.has(pathname))
  const bestEntrypoint = bestEntrypoints
    // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
    .sort((a, b) => a.path?.length! - b.path?.length!)
    .sort((a, b) => b.score - a.score)[0]
  if (entrypoints.length === 0 && bestEntrypoint.path) {
    entrypoints.push(bestEntrypoint.path)
  }

  return {aliases, entrypoints, flatAliases}
}
