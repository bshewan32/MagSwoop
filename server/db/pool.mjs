import mysql from 'mysql2/promise'

/**
 * Shared pool for MagSwoop's own tables (saves, wallet, entitlements, orders, subscriptions).
 * The leaderboard keeps its own bounded pool; both use the managed project DATABASE_URL.
 */
let pool = null
export function db() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured')
    pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 6, connectTimeout: 5000, timezone: 'Z', dateStrings: false })
  }
  return pool
}

/** Run `fn` inside a transaction on one connection; rolls back on any error. */
export async function tx(fn) {
  const conn = await db().getConnection()
  try {
    await conn.beginTransaction()
    const out = await fn(conn)
    await conn.commit()
    return out
  } catch (error) {
    try { await conn.rollback() } catch { /* connection already broken */ }
    throw error
  } finally {
    conn.release()
  }
}
