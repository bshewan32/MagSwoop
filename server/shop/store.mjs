import { db, tx } from '../db/pool.mjs'
import { ACTIVE_SUBSCRIPTION, FEATHER_ITEMS, PRODUCTS, monthlySkin, runFeathers } from './products.mjs'

/**
 * Provider-neutral player store. Stripe (today) and Steam (later) both fulfil through `fulfil()`,
 * and the game only ever reads `playerState()`. Every grant is idempotent: entitlements are keyed by
 * (user, sku), balance changes need a unique ledger ref, and orders are unique per checkout session.
 */

export class StoreError extends Error {
  constructor(code, status = 400) {
    super(code)
    this.code = code
    this.status = status
  }
}

const isDuplicate = error => error && (error.code === 'ER_DUP_ENTRY' || error.errno === 1062)

/** Apply a balance change once per `ref`. Returns false when the ref was already applied. */
async function applyLedger(conn, userId, ref, reason, { feathers = 0, bonusEggs = 0 }) {
  try {
    await conn.execute('INSERT INTO ms_ledger (user_id, ref, feathers, bonus_eggs, reason) VALUES (?, ?, ?, ?, ?)', [userId, ref, feathers, bonusEggs, reason])
  } catch (error) {
    if (isDuplicate(error)) return false
    throw error
  }
  await conn.execute(
    'INSERT INTO ms_wallets (user_id, feathers, bonus_eggs) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE feathers = feathers + VALUES(feathers), bonus_eggs = bonus_eggs + VALUES(bonus_eggs)',
    [userId, feathers, bonusEggs],
  )
  return true
}

async function grantSku(conn, userId, sku, source, sourceRef) {
  await conn.execute('INSERT IGNORE INTO ms_entitlements (user_id, sku, source, source_ref) VALUES (?, ?, ?, ?)', [userId, sku, source, sourceRef])
}

/**
 * Grant what `productId` includes, exactly once per `ref` (e.g. 'stripe:cs_…' or later 'steam:<orderid>').
 * Memberships are granted through subscription sync, not here.
 */
export async function fulfil(conn, userId, productId, source, ref) {
  const product = PRODUCTS[productId]
  if (!product) throw new StoreError('unknown_product')
  for (const sku of product.grants.skus ?? []) await grantSku(conn, userId, sku, source, ref)
  if (product.grants.feathers) await applyLedger(conn, userId, `${ref}:feathers`, 'purchase', { feathers: product.grants.feathers })
}

export async function isMember(userId, conn = db()) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM ms_subscriptions WHERE user_id = ? AND status IN (${ACTIVE_SUBSCRIPTION.map(() => '?').join(',')})
     AND (current_period_end IS NULL OR current_period_end > UTC_TIMESTAMP(3) - INTERVAL 1 DAY) LIMIT 1`,
    [userId, ...ACTIVE_SUBSCRIPTION],
  )
  return rows.length > 0
}

/** Everything the client needs to show ownership, balances and membership. */
export async function playerState(userId) {
  const pool = db()
  const member = await isMember(userId)
  if (member) {
    // Members keep each month's club skin permanently once they have been a member that month.
    const { sku, month } = monthlySkin()
    await pool.execute('INSERT IGNORE INTO ms_entitlements (user_id, sku, source, source_ref) VALUES (?, ?, ?, ?)', [userId, sku, 'grant', `club:${month}`])
  }
  const [skus] = await pool.execute('SELECT sku FROM ms_entitlements WHERE user_id = ?', [userId])
  const [[wallet]] = await pool.execute('SELECT feathers, bonus_eggs FROM ms_wallets WHERE user_id = ?', [userId])
  const [subs] = await pool.execute(
    'SELECT subscription_id, status, current_period_end, cancel_at_period_end FROM ms_subscriptions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1',
    [userId],
  )
  const sub = subs[0]
  const owned = new Set(skus.map(r => r.sku))
  if (member) owned.add('skin_crested')
  return {
    owned: [...owned].sort(),
    feathers: wallet?.feathers ?? 0,
    bonusEggs: wallet?.bonus_eggs ?? 0,
    membership: {
      active: member,
      status: sub?.status ?? 'none',
      renewsAt: sub?.current_period_end ? new Date(sub.current_period_end).toISOString() : null,
      cancelAtPeriodEnd: !!sub?.cancel_at_period_end,
    },
    monthlySkin: monthlySkin().sku,
  }
}

export async function ownsProduct(userId, productId) {
  const skus = PRODUCTS[productId]?.grants.skus ?? []
  if (!skus.length) return false
  const [rows] = await db().execute(`SELECT COUNT(*) AS n FROM ms_entitlements WHERE user_id = ? AND sku IN (${skus.map(() => '?').join(',')})`, [userId, ...skus])
  return Number(rows[0].n) >= skus.length
}

/** Spend feathers on a server-priced item. `requestId` makes a double-click a no-op. */
export async function spendFeathers(userId, itemId, requestId) {
  const item = FEATHER_ITEMS[itemId]
  if (!item) throw new StoreError('unknown_item')
  return tx(async conn => {
    if (item.sku) {
      const [[have]] = await conn.execute('SELECT 1 AS y FROM ms_entitlements WHERE user_id = ? AND sku = ?', [userId, item.sku])
      if (have) throw new StoreError('already_owned', 409)
    }
    await conn.execute('INSERT IGNORE INTO ms_wallets (user_id) VALUES (?)', [userId])
    const [[wallet]] = await conn.execute('SELECT feathers FROM ms_wallets WHERE user_id = ? FOR UPDATE', [userId])
    if ((wallet?.feathers ?? 0) < item.cost) throw new StoreError('not_enough_feathers', 409)
    const applied = await applyLedger(conn, userId, `spend:${userId}:${requestId}`, `buy:${itemId}`, { feathers: -item.cost, bonusEggs: item.bonusEggs ?? 0 })
    if (applied && item.sku) await grantSku(conn, userId, item.sku, 'feathers', `spend:${requestId}`)
    return applied
  })
}

/** Use one bonus egg at the start of a run. */
export async function useBonusEgg(userId, requestId) {
  return tx(async conn => {
    const [[wallet]] = await conn.execute('SELECT bonus_eggs FROM ms_wallets WHERE user_id = ? FOR UPDATE', [userId])
    if (!wallet || wallet.bonus_eggs < 1) throw new StoreError('no_bonus_eggs', 409)
    return applyLedger(conn, userId, `egg:${userId}:${requestId}`, 'use:bonus_egg', { bonusEggs: -1 })
  })
}

/**
 * Award feathers for a run this player submitted to the online leaderboard. The score is read from
 * the server's run record (owned by this account), never from the request; one award per run.
 */
export async function claimRunFeathers(userId, runId) {
  const [rows] = await db().execute(
    `SELECT r.score FROM game_lb_runs r
       JOIN game_lb_accounts a ON a.namespace = r.namespace AND a.player_id = r.player_id
      WHERE r.namespace = 'production' AND r.id = ? AND a.user_id = ? AND r.score IS NOT NULL`,
    [runId, userId],
  )
  if (!rows.length) throw new StoreError('run_not_found', 404)
  const member = await isMember(userId)
  const feathers = runFeathers(Number(rows[0].score), member)
  const applied = await tx(conn => applyLedger(conn, userId, `run:${runId}`, 'run', { feathers }))
  return { feathers: applied ? feathers : 0, member, alreadyClaimed: !applied }
}

// ---------- orders & subscriptions (written by the payment provider adapters) ----------

export async function createPendingOrder({ userId, provider, productId, sessionId }) {
  await db().execute('INSERT INTO ms_orders (user_id, provider, product, kind, status, checkout_session_id) VALUES (?, ?, ?, ?, ?, ?)', [
    userId, provider, productId, PRODUCTS[productId].kind, 'pending', sessionId,
  ])
}

/** Mark a checkout paid and fulfil it in one transaction (idempotent per session). */
export async function completeOrder({ userId, provider, productId, sessionId, paymentIntentId, subscriptionId, amountTotal, currency }) {
  return tx(async conn => {
    await conn.execute(
      `INSERT INTO ms_orders (user_id, provider, product, kind, status, checkout_session_id, payment_intent_id, subscription_id, amount_total, currency, completed_at)
       VALUES (?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE status = 'paid', payment_intent_id = VALUES(payment_intent_id), subscription_id = VALUES(subscription_id),
         amount_total = VALUES(amount_total), currency = VALUES(currency), completed_at = COALESCE(completed_at, VALUES(completed_at))`,
      [userId, provider, productId, PRODUCTS[productId].kind, sessionId, paymentIntentId ?? null, subscriptionId ?? null, amountTotal ?? null, currency ?? null],
    )
    if (PRODUCTS[productId].kind !== 'subscription') await fulfil(conn, userId, productId, provider, `${provider}:${sessionId}`)
  })
}

export async function failOrderBySession(sessionId) {
  await db().execute("UPDATE ms_orders SET status = 'failed' WHERE checkout_session_id = ? AND status = 'pending'", [sessionId])
}

export async function upsertSubscription({ subscriptionId, userId, provider, productId, status, periodEnd, cancelAtPeriodEnd }) {
  await db().execute(
    `INSERT INTO ms_subscriptions (subscription_id, user_id, provider, product, status, current_period_end, cancel_at_period_end)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE status = VALUES(status), current_period_end = VALUES(current_period_end), cancel_at_period_end = VALUES(cancel_at_period_end)`,
    [subscriptionId, userId, provider, productId, status, periodEnd, cancelAtPeriodEnd ? 1 : 0],
  )
}

export async function activeSubscriptionId(userId) {
  const [rows] = await db().execute(
    `SELECT subscription_id FROM ms_subscriptions WHERE user_id = ? AND status IN (${ACTIVE_SUBSCRIPTION.map(() => '?').join(',')}) ORDER BY updated_at DESC LIMIT 1`,
    [userId, ...ACTIVE_SUBSCRIPTION],
  )
  return rows[0]?.subscription_id ?? null
}

export async function orderStatus(userId, sessionId) {
  const [rows] = await db().execute('SELECT status, product FROM ms_orders WHERE user_id = ? AND checkout_session_id = ?', [userId, sessionId])
  return rows[0] ? { status: rows[0].status, product: rows[0].product } : { status: 'unknown', product: null }
}

/** Purchase history: paid and failed orders, plus recent still-processing ones. */
export async function listOrders(userId) {
  const [rows] = await db().execute(
    `SELECT id, product, kind, status, amount_total, currency, created_at, completed_at FROM ms_orders
      WHERE user_id = ? AND (status IN ('paid', 'failed') OR (status = 'pending' AND created_at > UTC_TIMESTAMP(3) - INTERVAL 1 DAY))
      ORDER BY created_at DESC LIMIT 50`,
    [userId],
  )
  return rows.map(r => ({
    id: Number(r.id),
    product: r.product,
    name: PRODUCTS[r.product]?.name ?? r.product,
    kind: r.kind,
    status: r.status === 'pending' ? 'processing' : r.status,
    amount: r.amount_total ?? PRODUCTS[r.product]?.amount ?? null,
    currency: (r.currency ?? 'aud').toUpperCase(),
    at: new Date(r.completed_at ?? r.created_at).toISOString(),
  }))
}

export async function customerId(userId, provider) {
  const [rows] = await db().execute('SELECT customer_id FROM ms_billing_customers WHERE user_id = ? AND provider = ?', [userId, provider])
  return rows[0]?.customer_id ?? null
}

export async function saveCustomerId(userId, provider, id) {
  await db().execute('INSERT IGNORE INTO ms_billing_customers (user_id, provider, customer_id) VALUES (?, ?, ?)', [userId, provider, id])
  return customerId(userId, provider)
}

export async function userForCustomer(provider, id) {
  const [rows] = await db().execute('SELECT user_id FROM ms_billing_customers WHERE provider = ? AND customer_id = ?', [provider, id])
  return rows[0]?.user_id ?? null
}

export async function eventSeen(provider, eventId) {
  const [rows] = await db().execute('SELECT 1 AS y FROM ms_processed_events WHERE provider = ? AND event_id = ?', [provider, eventId])
  return rows.length > 0
}

export async function markEvent(provider, eventId, type) {
  await db().execute('INSERT IGNORE INTO ms_processed_events (provider, event_id, type) VALUES (?, ?, ?)', [provider, eventId, type])
}

// ---------- cloud save ----------

export const MAX_SAVE_BYTES = 32 * 1024

export async function loadSave(userId) {
  const [rows] = await db().execute('SELECT save_json, updated_at FROM ms_profiles WHERE user_id = ?', [userId])
  if (!rows.length) return null
  try {
    return { data: JSON.parse(rows[0].save_json), updatedAt: new Date(rows[0].updated_at).toISOString() }
  } catch {
    return null
  }
}

export async function storeSave(userId, data) {
  const json = JSON.stringify(data)
  if (json.length > MAX_SAVE_BYTES) throw new StoreError('save_too_large', 413)
  await db().execute(
    'INSERT INTO ms_profiles (user_id, save_json, updated_at) VALUES (?, ?, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE save_json = VALUES(save_json), updated_at = VALUES(updated_at)',
    [userId, json],
  )
  return loadSave(userId)
}

// ---------- leaderboards with member badges and a weekly view ----------

/** Monday 00:00 in Australian Eastern time (UTC+10, ignoring DST for a stable week key), as UTC. */
export function weekStart(now = new Date()) {
  const aest = new Date(now.getTime() + 10 * 3600_000)
  const day = (aest.getUTCDay() + 6) % 7
  const monday = Date.UTC(aest.getUTCFullYear(), aest.getUTCMonth(), aest.getUTCDate() - day)
  return new Date(monday - 10 * 3600_000)
}

export async function board(boardId, period, userId, limit = 20) {
  const pool = db()
  const memberSql = `EXISTS (SELECT 1 FROM ms_subscriptions s WHERE s.user_id = a.user_id AND s.status IN ('active','trialing')
                       AND (s.current_period_end IS NULL OR s.current_period_end > UTC_TIMESTAMP(3) - INTERVAL 1 DAY))`
  let rows
  if (period === 'week') {
    ;[rows] = await pool.query(
      `SELECT t.player_id, p.display_name, t.score, t.achieved_at, a.user_id, ${memberSql} AS member FROM (
         SELECT r.player_id, MAX(r.score) AS score, MIN(r.submitted_at) AS achieved_at FROM game_lb_runs r
          WHERE r.namespace = 'production' AND r.board_id = ? AND r.score IS NOT NULL AND r.submitted_at >= ?
          GROUP BY r.player_id) t
       JOIN game_lb_players p ON p.namespace = 'production' AND p.id = t.player_id
       LEFT JOIN game_lb_accounts a ON a.namespace = 'production' AND a.player_id = t.player_id
       ORDER BY t.score DESC, t.achieved_at ASC LIMIT ?`,
      [boardId, weekStart(), limit],
    )
  } else {
    ;[rows] = await pool.query(
      `SELECT b.player_id, p.display_name, b.score, b.achieved_at, a.user_id, ${memberSql} AS member FROM game_lb_best b
       JOIN game_lb_players p ON p.namespace = b.namespace AND p.id = b.player_id
       LEFT JOIN game_lb_accounts a ON a.namespace = b.namespace AND a.player_id = b.player_id
       WHERE b.namespace = 'production' AND b.board_id = ?
       ORDER BY b.score DESC, b.achieved_at ASC LIMIT ?`,
      [boardId, limit],
    )
  }
  const entries = rows.map((r, i) => ({
    rank: i + 1,
    name: r.display_name,
    score: Number(r.score),
    member: !!Number(r.member),
    me: userId != null && r.user_id === userId,
  }))
  return { boardId, period, entries, weekStart: period === 'week' ? weekStart().toISOString() : null }
}
