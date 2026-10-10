import Stripe from 'stripe'
import { CURRENCY, PRODUCTS } from './products.mjs'
import * as store from './store.mjs'

/**
 * Stripe payment adapter. It only translates between Stripe and the provider-neutral store; a
 * Steam adapter can sit beside it later without touching gameplay or the store schema.
 */
const PROVIDER = 'stripe'
let client = null
function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new store.StoreError('payments_unavailable', 503)
  if (!client) client = new Stripe(process.env.STRIPE_SECRET_KEY)
  return client
}

const ALLOWED_HOST_SUFFIXES = ['.manus.computer', '.manuspre.computer', '.manus-asia.computer', '.manuscomputer.ai', '.manusvm.computer', '.manus.game', '.manus.space']

/**
 * Validate the browser-visible page the buyer returns to. It must be this game's own origin: a Manus
 * preview/publication host, the host serving this request (custom domains), or localhost in dev.
 */
export function returnBase(raw, requestHost) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new store.StoreError('invalid_return_url')
  }
  const host = url.hostname.toLowerCase()
  const local = host === 'localhost' || host === '127.0.0.1'
  const okHost = local || ALLOWED_HOST_SUFFIXES.some(s => host.endsWith(s)) || (requestHost && url.host.toLowerCase() === String(requestHost).toLowerCase())
  if (!okHost || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw new store.StoreError('invalid_return_url')
  return `${url.origin}${url.pathname}`
}

async function ensureCustomer(user) {
  const existing = await store.customerId(user.id, PROVIDER)
  if (existing) return existing
  const customer = await stripe().customers.create({
    email: user.email || undefined,
    name: user.name || undefined,
    metadata: { user_id: String(user.id) },
  })
  return store.saveCustomerId(user.id, PROVIDER, customer.id)
}

/** Create a Checkout Session for the signed-in buyer and record it as a pending order. */
export async function createCheckout(user, productId, returnUrl, requestHost) {
  const product = PRODUCTS[productId]
  if (!product) throw new store.StoreError('unknown_product')
  if (product.kind === 'subscription' && (await store.isMember(user.id))) throw new store.StoreError('already_member', 409)
  if (product.kind === 'one_time' && (await store.ownsProduct(user.id, productId))) throw new store.StoreError('already_owned', 409)
  const base = returnBase(returnUrl, requestHost)
  const customer = await ensureCustomer(user)
  const metadata = {
    user_id: String(user.id),
    product: productId,
    customer_email: user.email ?? '',
    customer_name: user.name ?? '',
  }
  const subscription = product.kind === 'subscription'
  const session = await stripe().checkout.sessions.create({
    mode: subscription ? 'subscription' : 'payment',
    // The customer record carries the buyer's account email, so Checkout is prefilled with it.
    customer,
    client_reference_id: String(user.id),
    metadata,
    allow_promotion_codes: true,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: CURRENCY,
        unit_amount: product.amount,
        product_data: { name: product.name, description: product.description },
        ...(subscription ? { recurring: { interval: product.interval } } : {}),
      },
    }],
    ...(subscription ? { subscription_data: { metadata } } : { payment_intent_data: { metadata } }),
    // Literal {CHECKOUT_SESSION_ID} is substituted by Stripe; do not URL-encode it.
    success_url: `${base}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}?checkout=cancel`,
  })
  await store.createPendingOrder({ userId: user.id, provider: PROVIDER, productId, sessionId: session.id })
  return { url: session.url, sessionId: session.id }
}

function periodEnd(sub) {
  // Newer API versions moved the period onto subscription items.
  const end = sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end
  return end ? new Date(end * 1000) : null
}

/** Re-read a subscription from Stripe (events can arrive out of order) and store its state. */
async function syncSubscription(subscriptionId) {
  const sub = await stripe().subscriptions.retrieve(subscriptionId)
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
  const userId = Number(sub.metadata?.user_id) || (customer ? await store.userForCustomer(PROVIDER, customer) : null)
  if (!userId) return
  await store.upsertSubscription({
    subscriptionId: sub.id,
    userId,
    provider: PROVIDER,
    productId: sub.metadata?.product || 'swoop_club',
    status: sub.status,
    periodEnd: periodEnd(sub),
    cancelAtPeriodEnd: sub.cancel_at_period_end || !!sub.cancel_at,
  })
}

async function onCheckoutCompleted(session) {
  const userId = Number(session.metadata?.user_id || session.client_reference_id)
  const productId = session.metadata?.product
  if (!userId || !PRODUCTS[productId]) return
  if (session.mode === 'payment' && session.payment_status !== 'paid') return
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
  await store.completeOrder({
    userId,
    provider: PROVIDER,
    productId,
    sessionId: session.id,
    paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id,
    subscriptionId,
    amountTotal: session.amount_total,
    currency: session.currency,
  })
  if (subscriptionId) await syncSubscription(subscriptionId)
}

async function onPaymentFailed(intent) {
  const sessions = await stripe().checkout.sessions.list({ payment_intent: intent.id, limit: 1 })
  if (sessions.data[0]) await store.failOrderBySession(sessions.data[0].id)
}

/**
 * Express handler for POST /api/stripe/webhook. Must be mounted with express.raw() so the exact
 * request bytes reach signature verification.
 */
export async function webhook(req, res) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    res.status(503).json({ error: 'webhook_not_configured' })
    return
  }
  let event
  try {
    event = stripe().webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret)
  } catch {
    res.status(400).json({ error: 'invalid_signature' })
    return
  }
  try {
    if (await store.eventSeen(PROVIDER, event.id)) {
      res.json({ received: true, duplicate: true })
      return
    }
    const obj = event.data.object
    switch (event.type) {
      case 'checkout.session.completed':
        await onCheckoutCompleted(obj)
        break
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscription(obj.id)
        break
      case 'payment_intent.payment_failed':
        await onPaymentFailed(obj)
        break
      default:
        // payment_intent.succeeded and anything else: fulfilment happens on checkout.session.completed.
        break
    }
    await store.markEvent(PROVIDER, event.id, event.type)
    res.json({ received: true })
  } catch (error) {
    console.error('[stripe] webhook processing failed', event.type, error instanceof Error ? error.message : 'unknown')
    // A 5xx makes Stripe redeliver; fulfilment is idempotent so the retry is safe.
    res.status(500).json({ error: 'processing_failed' })
  }
}

/** Cancel (at period end) or resume the player's Swoop Club membership. */
export async function setMembershipCancel(userId, cancel) {
  const id = await store.activeSubscriptionId(userId)
  if (!id) throw new store.StoreError('no_membership', 404)
  await stripe().subscriptions.update(id, { cancel_at_period_end: cancel })
  await syncSubscription(id)
}

let portalConfig = null
/** Stripe-hosted page for payment method, invoices and cancellation. */
export async function billingPortal(userId, returnUrl, requestHost) {
  const customer = await store.customerId(userId, PROVIDER)
  if (!customer) throw new store.StoreError('no_billing_account', 404)
  const base = returnBase(returnUrl, requestHost)
  const create = () => stripe().billingPortal.sessions.create({ customer, return_url: base, ...(portalConfig ? { configuration: portalConfig } : {}) })
  try {
    return { url: (await create()).url }
  } catch (error) {
    // A fresh test account has no default portal configuration yet; create a minimal one once.
    if (portalConfig || !/configuration/i.test(error?.message ?? '')) throw error
    const config = await stripe().billingPortal.configurations.create({
      business_profile: { headline: 'Magpie Sky Patrol: manage your Swoop Club membership' },
      features: {
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: { enabled: true, mode: 'at_period_end' },
      },
    })
    portalConfig = config.id
    return { url: (await create()).url }
  }
}
