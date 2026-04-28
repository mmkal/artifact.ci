import {defineConfig} from 'sqlfu'

export default defineConfig({
  db: '.alchemy/sqlfu-local.sqlite',
  definitions: 'definitions.sql',
  migrations: {
    path: 'migrations',
    preset: 'd1',
  },
  queries: 'sql',
  generate: {
    authority: 'desired_schema',
  },
})
