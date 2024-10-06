import * as path from 'path'
import {type Config} from 'pgkit/config'

export default {
  client: {
    connectionString: process.env.PGKIT_CONNECTION_STRING || 'postgresql://postgres:postgres@localhost:5500/postgres',
  },
  typegen: ({defaults}) => ({
    // psqlCommand: 'docker-compose exec -T db psql',
    checkClean: [],
    pgTypeToTypeScript: type => {
      if (type === 'prefixed_ksuid') return 'string'
      return defaults.defaultPGDataTypeToTypeScriptMappings[type]
    },
    writeTypes: queries => {
      queries.forEach(query => {
        query.fields.forEach(field => {
          // add a `_brand` to all string id fields:
          if (field.regtype === 'prefixed_ksuid' && field.column?.name === 'id') {
            field.typescript = `import('~/db').Id<${JSON.stringify(field.column.table || '???')}>`
          }
        })
      })

      return defaults.defaultWriteTypes({
        writeFile: async (filepath, content) => {
          // Typescript expands `{"id_for":"foo"}` into `{\n  "id_for": "foo"\n}` and prettier respects it, but I don't.
          content = content.replaceAll(/{\n\s+("?id_for"?)/g, '{ $1')
          return defaults.defaultWriteFile(filepath, content)
        },
      })(queries)
    },
  }),
  migrator: {
    migrationsPath: path.join(process.cwd(), 'migrations'),
    migrationTableName: 'pgkit_migrations',
    defaultMigraOptions: {
      schema: 'public',
    },
  },
} satisfies Config
