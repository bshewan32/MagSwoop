#!/usr/bin/env node
/**
 * Finite, repeatable migration step for MagSwoop's own tables. Applies the canonical Webdev users
 * table first, then server/db/migrations/NNN_*.sql in order, recording name + SHA-256 so each file
 * runs once and edits to applied files are refused. Never runs on server start-up or publish.
 */
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const here = dirname(fileURLToPath(import.meta.url))
const NAME = /^\d{3}_[a-z0-9_]+\.sql$/

async function load() {
  const files = [{ name: '000_initial_users.sql', path: join(here, '..', '0000_initial_users.sql') }]
  for (const name of (await readdir(join(here, 'migrations'))).filter(n => NAME.test(n)).sort()) files.push({ name, path: join(here, 'migrations', name) })
  return Promise.all(files.map(async f => {
    const sql = await readFile(f.path, 'utf8')
    return { name: f.name, sql, sha256: createHash('sha256').update(sql).digest('hex') }
  }))
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Project DATABASE_URL is required')
  const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, multipleStatements: true, connectTimeout: 5000 })
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS ms_schema_migrations (
      name VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))`)
    const [rows] = await conn.query('SELECT name, sha256 FROM ms_schema_migrations')
    const applied = new Map(rows.map(r => [r.name, r.sha256]))
    for (const m of await load()) {
      const prev = applied.get(m.name)
      if (prev && prev !== m.sha256) throw new Error(`Migration ${m.name} changed after it was applied`)
      if (prev) continue
      await conn.query(m.sql)
      await conn.execute('INSERT INTO ms_schema_migrations (name, sha256) VALUES (?, ?)', [m.name, m.sha256])
      console.log(`applied ${m.name}`)
    }
    console.log('MagSwoop store migrations are current')
  } finally {
    await conn.end()
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
