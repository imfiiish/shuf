import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db.ts'

// App-schema migrations. The fishDict dictionary (`public`) ships as
// db/dump.sql and is loaded by Postgres on first boot; everything under `app`
// is owned here. Applied files are recorded in app.schema_migration, each runs
// once in its own transaction, and the server migrates on startup — so a fresh
// volume plus `up -d` is enough, and a later code change just adds a file.
//
// Add a migration as db/migrations/<number>_<name>.sql, keep it small and
// forward-only. 0001_baseline is the original schema (idempotent, so it also
// adopts databases created before migrations existed).

const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', 'db', 'migrations')

export async function migrate(): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS app')
    await client.query(
      `CREATE TABLE IF NOT EXISTS app.schema_migration (
         name       text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    )
    const { rows } = await client.query<{ name: string }>(
      `SELECT name FROM app.schema_migration`,
    )
    const applied = new Set(rows.map((r) => r.name))

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    for (const file of files) {
      if (applied.has(file)) continue
      const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query(
          `INSERT INTO app.schema_migration (name) VALUES ($1)`,
          [file],
        )
        await client.query('COMMIT')
        console.log(`[migrate] applied ${file}`)
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw new Error(`migration ${file} failed: ${String(err)}`)
      }
    }
  } finally {
    client.release()
  }
}

/** Retry so a database that is still starting up does not crash the boot. */
export async function migrateWithRetry(
  attempts = 15,
  delayMs = 2000,
): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await migrate()
      return
    } catch (err) {
      if (i >= attempts) throw err
      console.warn(`[migrate] attempt ${i} failed, retrying…`, err)
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
}

// `node server/migrate.ts` runs them and exits.
if (
  process.argv[1] != null &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  migrateWithRetry()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
