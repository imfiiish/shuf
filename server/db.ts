import './env.ts'
import { Pool } from 'pg'

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://shuf:shuf@localhost:5433/shuf'

export const pool = new Pool({
  connectionString,
  // App tables live in `app`, the fishDict dictionary in `public`. Setting this
  // on the connection keeps the server's unqualified queries (`FROM users`, ...)
  // working without a schema prefix. See db/schema.sql.
  options: '-c search_path=app,public',
})
