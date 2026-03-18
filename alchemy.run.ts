export default {
  name: 'artifact-ci',
  workers: {
    frontdoor: {
      entry: 'apps/frontdoor/src/index.ts',
      domains: ['artifact.ci'],
      bindings: {
        APP: 'app',
        DOCS: 'docs',
      },
    },
    app: {
      entry: 'apps/app/src/index.ts',
    },
    docs: {
      entry: 'apps/docs/src/index.ts',
    },
  },
} as const
