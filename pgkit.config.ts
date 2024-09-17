import * as path from 'path'
import {type Config} from 'pgkit/config'

export default {
  client: {
    connectionString: process.env.PGKIT_CONNECTION_STRING || 'postgresql://postgres:postgres@localhost:5500/postgres',
  },
  typegen: {
    psqlCommand: 'docker-compose exec -T db psql',
    checkClean: [],
  },
  migrator: {
    migrationsPath: path.join(process.cwd(), 'migrations'),
    migrationTableName: 'pgkit_migrations',
    defaultMigraOptions: {
      schema: 'public',
    },
  },
} satisfies Config
