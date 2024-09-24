/** @type {import('eslint-plugin-mmkal').CodegenPreset} */
module.exports.generateReadme = ({dependencies: {fs}}) => {
  const websiteIndexMd = fs.readFileSync('src/pages/index.md', 'utf8')
  const readmeMd = websiteIndexMd
    .replaceAll(`(/reports/`, `(/public/reports/`)
    .replaceAll(/\(\/recipes\/(.*)\)/g, `(./src/pages/recipes/$1.md)`)
    .replaceAll('codegen:start', 'codegen:disabled')
  return readmeMd
}
