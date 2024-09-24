/** @type {import('eslint-plugin-mmkal').CodegenPreset} */
module.exports.generateReadme = ({dependencies: {fs}}) => {
  const websiteIndexMd = fs.readFileSync('src/pages/index.md', 'utf8')
  const readmeMd = websiteIndexMd
    .replaceAll(`(/reports/`, `(/public/reports/`)
    .replaceAll(/\(\/(\S*)\)/g, `(https://www.artifact.ci/$1)`)
    .replaceAll('codegen:start', 'codegen:disabled')
  return readmeMd
}
