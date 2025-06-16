/** @type {import('eslint-plugin-mmkal').CodegenPreset} */
module.exports.generateReadme = ({dependencies: {fs, arktype, zx}}) => {
  const websiteIndexMd = fs.readFileSync('src/pages/index.mdx', 'utf8')
  let readmeMd = websiteIndexMd
    .replace('# artifact.ci', '') // rm title
    .trim()
    .replaceAll(/\(\/(\S*)\)/g, `(https://www.artifact.ci/$1)`)
    .replaceAll('codegen:start', 'codegen:disabled')
  const customComponentsStart = readmeMd.indexOf('import')
  const customComponentsEnd = readmeMd.indexOf('## Why')

  readmeMd =
    readmeMd.slice(0, customComponentsStart) +
    `Docs and install instructions on [artifact.ci](https://artifact.ci).\n\n` +
    readmeMd.slice(customComponentsEnd)

  return readmeMd
}

// codegen:start {preset: eval}
// eslint-whatever
/** @type {import('eslint-plugin-mmkal').CodegenPreset} */
const generate = ({dependencies: {fs, path, dedent}, context}) => {
  const parent = path.resolve(context.physicalFilename, '../../src')
  const tsFiles = fs
    .readdirSync(parent)
    .filter(file => fs.statSync(path.resolve(parent, file)).isFile() && file.match(/.*/))
  return dedent`
    // omg: ${tsFiles.join(', ')}
    // btw because this code is running at *lint time*, we can use all kinds of crazy libraries that we don't want to add as prod dependencies
    export const files = ${JSON.stringify(tsFiles, null, 2)}
  `
}

// omg: auth.ts, db.ts, middleware.ts.ignoreme, site-config.ts, tag-logger.ts, test.ignoreme.ts
// btw because this code is running at *lint time*, we can use all kinds of crazy libraries that we don't want to add as prod dependencies
export const files = [
  'auth.ts',
  'db.ts',
  'middleware.ts.ignoreme',
  'site-config.ts',
  'tag-logger.ts',
  'test.ignoreme.ts',
]
// codegen:end

// codegen:start {preset: eval}
/** @type {import('eslint-plugin-mmkal').CodegenPreset} */
const _generate2 = ({dependencies: {glob, dedent}, context}) => {
  const pages = glob.globSync('src/app/**/page.{tsx,js,jsx}').map(srcPath => {
    const relativePath = srcPath.replace('src/app/', '')
    const pathParams = Array.from(relativePath.matchAll(/\[(.*?)]/g)).map(m => m[1])
    return {
      srcPath,
      relativePath,
      pathParams,
    }
  })
  return dedent`
    const pages = ${JSON.stringify(pages.slice(), null, 2)}
  `
}

const pages = [
  {
    srcPath: 'src/app/dashboard/page.tsx',
    relativePath: 'dashboard/page.tsx',
    pathParams: [],
  },
  {
    srcPath: 'src/app/artifact/view/page.tsx',
    relativePath: 'artifact/view/page.tsx',
    pathParams: [],
  },
  {
    srcPath: 'src/app/artifact/view/[owner]/page.tsx',
    relativePath: 'artifact/view/[owner]/page.tsx',
    pathParams: ['owner'],
  },
  {
    srcPath: 'src/app/artifact/view/[owner]/[repo]/page.tsx',
    relativePath: 'artifact/view/[owner]/[repo]/page.tsx',
    pathParams: ['owner', 'repo'],
  },
  {
    srcPath: 'src/app/artifact/view/[owner]/[repo]/[aliasType]/page.tsx',
    relativePath: 'artifact/view/[owner]/[repo]/[aliasType]/page.tsx',
    pathParams: ['owner', 'repo', 'aliasType'],
  },
  {
    srcPath: 'src/app/artifact/view/[owner]/[repo]/[aliasType]/[identifier]/page.tsx',
    relativePath: 'artifact/view/[owner]/[repo]/[aliasType]/[identifier]/page.tsx',
    pathParams: ['owner', 'repo', 'aliasType', 'identifier'],
  },
  {
    srcPath: 'src/app/artifact/view/[owner]/[repo]/[aliasType]/[identifier]/[artifactName]/page.tsx',
    relativePath: 'artifact/view/[owner]/[repo]/[aliasType]/[identifier]/[artifactName]/page.tsx',
    pathParams: ['owner', 'repo', 'aliasType', 'identifier', 'artifactName'],
  },
]
// codegen:end
