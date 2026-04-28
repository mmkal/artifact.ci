export type Resolution =
  | {type: 'serve'; entryName: string}
  | {type: 'redirect'; filepath: string; trailingSlash: boolean}
  | {type: 'not_found'}

/**
 * Given the requested filepath (the portion after `.../[artifactName]/`), whether the URL
 * had a trailing slash, and the set of entry names (literal file paths within the artifact),
 * decide what to do. See tasks/complete/... for the behavioural spec.
 *
 * When both `foo.html` and `foo/index.html` exist, `foo/index.html` wins — matches Cloudflare.
 */
export function resolveFilepath(filepath: string, trailingSlash: boolean, entryNames: Set<string>): Resolution {
  if (trailingSlash) {
    const asIndex = filepath === '' ? 'index.html' : `${filepath}/index.html`
    if (entryNames.has(asIndex)) {
      return {type: 'serve', entryName: asIndex}
    }
    if (filepath !== '' && entryNames.has(`${filepath}.html`)) {
      return {type: 'redirect', filepath, trailingSlash: false}
    }
    return {type: 'not_found'}
  }

  if (filepath === '') {
    if (entryNames.has('index.html')) {
      return {type: 'serve', entryName: 'index.html'}
    }
    return {type: 'not_found'}
  }

  if (entryNames.has(filepath)) {
    return {type: 'serve', entryName: filepath}
  }
  if (entryNames.has(`${filepath}/index.html`)) {
    return {type: 'redirect', filepath, trailingSlash: true}
  }
  if (entryNames.has(`${filepath}.html`)) {
    return {type: 'serve', entryName: `${filepath}.html`}
  }
  return {type: 'not_found'}
}
