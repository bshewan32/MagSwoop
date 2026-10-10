// E2E: create a throwaway test user, open real Stripe Checkout (test mode), pay with 4242…,
// then wait for the signed webhook (delivered to the preview origin) to fulfil the order.
import mysql from 'mysql2/promise'
import { chromium } from '../node_modules/playwright/index.mjs'
import * as payments from './shop/stripe.mjs'
import * as store from './shop/store.mjs'

const PREVIEW = 'https://8328-ixkhv8as4c13k4v6a3fid-951dc2b0.sg2.manus.computer/'
const product = process.argv[2] ?? 'skins_pack'
const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL })
const openId = `e2e-test-${Date.now()}`
const [r] = await conn.execute('INSERT INTO users (openId, name, email, loginMethod) VALUES (?, ?, ?, ?)', [openId, 'E2E Tester', 'e2e-tester@example.com', 'test'])
const user = { id: r.insertId, name: 'E2E Tester', email: 'e2e-tester@example.com' }
console.log('test user', user.id)
let ok = false
try {
  const { url, sessionId } = await payments.createCheckout(user, product, PREVIEW, null)
  console.log('session', sessionId.slice(0, 14) + '…')
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(url)
  const fill = async (sel, val) => { const el = page.locator(sel); await el.waitFor({ timeout: 30000 }); await el.fill(val) }
  // Card may sit behind an accordion button on newer Checkout pages.
  const cardBtn = page.locator('[data-testid="card-accordion-item-button"]')
  if (await cardBtn.count()) await cardBtn.click().catch(() => {})
  await fill('#cardNumber', '4242424242424242')
  await fill('#cardExpiry', '12 / 34')
  await fill('#cardCvc', '123')
  await fill('#billingName', 'E2E Tester')
  const country = page.locator('#billingCountry')
  if (await country.count()) await country.selectOption('AU').catch(() => {})
  const zip = page.locator('#billingPostalCode')
  if (await zip.count() && await zip.isVisible()) await zip.fill('3000')
  await page.locator('[data-testid="hosted-payment-submit-button"]').click()
  await page.waitForURL(/checkout=success/, { timeout: 60000 })
  console.log('redirected to', page.url().replace(/session_id=[^&]+/, 'session_id=…'))
  await browser.close()
  for (let i = 0; i < 30; i += 1) {
    const s = await store.orderStatus(user.id, sessionId)
    if (s.status !== 'processing') { console.log('order', s.status); ok = s.status === 'paid'; break }
    await new Promise(res => setTimeout(res, 2000))
  }
  const state = await store.playerState(user.id)
  console.log('owned', state.owned.join(','), 'feathers', state.feathers, 'member', state.membership.active)
} finally {
  // Remove the throwaway user's rows.
  for (const t of ['ms_entitlements', 'ms_orders', 'ms_subscriptions', 'ms_billing_customers', 'ms_ledger', 'ms_wallets', 'ms_profiles']) {
    await conn.execute(`DELETE FROM ${t} WHERE user_id = ?`, [user.id]).catch(e => console.log('cleanup', t, e.code))
  }
  await conn.execute('DELETE FROM users WHERE id = ?', [user.id])
  await conn.end()
}
console.log(ok ? 'E2E OK' : 'E2E FAILED')
process.exit(ok ? 0 : 1)
