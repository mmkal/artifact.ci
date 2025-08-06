/** @type {import('eslint-plugin-mmkal').CodegenPreset} */
module.exports.generateReadme = ({dependencies: {fs}}) => {
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
const _generate = () => {
  return `// isn't this cool`
}

// isn't this cool
// codegen:end
