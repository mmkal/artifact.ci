const mmkal = require('eslint-plugin-mmkal')

module.exports = [
  ...mmkal.recommendedNextConfigs,
  {
    rules: {
      'no-console': 'off', // todo: reenable
      '@typescript-eslint/no-namespace': 'off', // mmkal
    },
  },
  {ignores: ['**/generated/**']},
]
