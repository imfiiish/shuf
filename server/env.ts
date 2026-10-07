import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Load the local, gitignored .env so machine-specific values (DATABASE_URL,
 * PORT, ...) need neither be hard-coded in source nor exported by hand. No-op
 * when the file is missing (fresh clone, CI).
 *
 * Import this before anything that reads process.env.
 */
const envFile = resolve(import.meta.dirname, '..', '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)
