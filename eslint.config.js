const mmkal = require('eslint-plugin-mmkal')

module.exports = [
  ...mmkal.recommendedNextConfigs,
  {
    rules: {
      'no-console': 'off', // todo: reenable
    },
  },
  {
    plugins: {
      pp: {
        processors: {
          yml: (() => {
            const codegenMarkdownCommentedOutFile = 'codegen-commented-out.js'
            return {
              preprocess: (text, filename) =>
                // console.log({text, filename}) ||
                [
                  {
                    filename: codegenMarkdownCommentedOutFile,
                    text: text
                      .split(/\r?\n/)
                      .map(line => line && `// eslint-plugin-codegen:trim${line}`)
                      .join('\n'),
                  },
                ],
              postprocess(messageLists, filename) {
                return (
                  // first one is the codegen-able file, the rest are from eslint-plugin-markdown
                  // but we're only interested in the codegen messages, not formatting issues etc. - those can cause bogus "fixes" which delete real content
                  messageLists[0].filter(m => m.ruleId === 'codegen/codegen')
                )
              },
              supportsAutofix: true,
            }
          })(),
        },
      },
    },
  },
  {
    files: ['upload/action.yml'],
    processor: 'pp/yml',
    rules: {
      'codegen/codegen': 'warn',
    },
  },
]
