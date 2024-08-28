const mmkal = require('eslint-plugin-mmkal')

module.exports = [
  ...mmkal.recommendedNextConfigs,
  {
    files: ['**/*.tsx'],
    rules: {
      '@typescript-eslint/no-misused-promises': 'off', // mmkal
    },
  },
]
