import { createHash } from 'node:crypto'
import { db } from '../db/pool.mjs'

/**
 * Guest players: buy without any login. The browser generates a random restore code
 * (MAG-XXXX-XXXX-XXXX-XXXX, 80 bits, Crockford base32) and sends it as the X-Guest-Token header.
 * Only a SHA-256 of the code is stored, as the users.openId ("guest:<hash>"), so every existing
 * store/entitlement table works unchanged. Typing the same code on another device restores
 * the same purchases. A custom header cannot be sent cross-site without CORS, which this API
 * never enables, so it is not usable for CSRF.
 */
export const GUEST_CODE = /^MAG(-[0-9A-HJKMNP-TV-Z]{4}){4}$/

export function normaliseCode(raw) {
  const code = String(raw ?? '').trim().toUpperCase().replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1')
  if (code.length !== 19 || !code.startsWith('MAG')) return null
  const body = code.slice(3)
  const formatted = `MAG-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}`
  return GUEST_CODE.test(formatted) ? formatted : null
}

function openIdFor(code) {
  return `guest:${createHash('sha256').update(`magswoop-guest:${code}`).digest('hex').slice(0, 58)}`
}

/** Find-or-create the guest user row for a valid restore code; null for anything else. */
export async function guestUser(rawCode) {
  const code = normaliseCode(rawCode)
  if (!code) return null
  const openId = openIdFor(code)
  const pool = db()
  await pool.query(
    "INSERT INTO users (openId, name, loginMethod) VALUES (?, 'Guest magpie', 'guest') ON DUPLICATE KEY UPDATE lastSignedIn = now()",
    [openId],
  )
  const [rows] = await pool.query('SELECT * FROM users WHERE openId = ? LIMIT 1', [openId])
  const user = rows[0]
  return user ? { ...user, guest: true, guestCode: code } : null
}

/** Does this guest code already own anything? Used by "restore purchases" to give useful feedback. */
export async function guestHasHistory(rawCode) {
  const code = normaliseCode(rawCode)
  if (!code) return false
  const [rows] = await db().query(
    `SELECT 1 FROM users u WHERE u.openId = ? AND (
       EXISTS (SELECT 1 FROM ms_orders o WHERE o.user_id = u.id) OR
       EXISTS (SELECT 1 FROM ms_entitlements e WHERE e.user_id = u.id)) LIMIT 1`,
    [openIdFor(code)],
  )
  return rows.length > 0
}
