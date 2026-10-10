/**
 * The one place that defines what MagSwoop sells. Checkout, webhook fulfilment and the in-game shop
 * all read this module. Prices are created inline in Checkout (price_data), so no Stripe Dashboard
 * product setup is needed; change amounts here.
 *
 * `grants` is provider-neutral: a future Steam microtransaction for the same product id grants the
 * same SKUs/feathers through the same store functions.
 */
export const CURRENCY = 'aud'

/** Cosmetic and content SKUs a player can own (ms_entitlements.sku). */
export const SKUS = {
  skin_albino: { type: 'skin' },
  skin_golden: { type: 'skin' },
  skin_night: { type: 'skin' },
  skin_crested: { type: 'skin', membersOnly: true },
  skin_aurora: { type: 'skin', monthly: true },
  skin_sunset: { type: 'skin', monthly: true },
  skin_frost: { type: 'skin', monthly: true },
  season_plus: { type: 'content' },
}

export const PRODUCTS = {
  skins_pack: {
    kind: 'one_time',
    name: 'Plumage Pack',
    description: 'Three magpie skins for any bird in your flock: Albino, Golden Wattle and Night Raider.',
    amount: 299,
    grants: { skus: ['skin_albino', 'skin_golden', 'skin_night'] },
  },
  season_plus: {
    kind: 'one_time',
    name: 'Magpie Season+',
    description: 'The Beach Esplanade (surfers and scooter riders) and Endless mode with its own leaderboard.',
    amount: 499,
    grants: { skus: ['season_plus'] },
  },
  feathers_500: {
    kind: 'consumable',
    name: '500 Feathers',
    description: 'In-game currency for single skins and bonus eggs.',
    amount: 199,
    grants: { feathers: 500 },
  },
  swoop_club: {
    kind: 'subscription',
    name: 'Swoop Club',
    description: 'Monthly membership: double feathers from every run, the Crested skin, a new skin each month and a member badge.',
    amount: 299,
    interval: 'month',
    grants: { membership: true },
  },
}

/** Things bought with feathers (server-priced; the client only names the item). */
export const FEATHER_ITEMS = {
  skin_albino: { cost: 250, sku: 'skin_albino' },
  skin_golden: { cost: 250, sku: 'skin_golden' },
  skin_night: { cost: 250, sku: 'skin_night' },
  bonus_egg: { cost: 120, bonusEggs: 1 },
}

/** Feathers earned from a finished, submitted run (members earn double). */
export function runFeathers(score, member) {
  const base = Math.max(0, Math.min(60, Math.floor(score / 100)))
  return member ? base * 2 : base
}

const MONTHLY = ['skin_aurora', 'skin_sunset', 'skin_frost']
/** The Swoop Club skin of the month for a given date (kept permanently once earned). */
export function monthlySkin(date = new Date()) {
  const n = date.getUTCFullYear() * 12 + date.getUTCMonth()
  return { sku: MONTHLY[n % MONTHLY.length], month: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}` }
}

export const ACTIVE_SUBSCRIPTION = ['active', 'trialing']
