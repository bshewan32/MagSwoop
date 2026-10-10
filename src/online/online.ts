import { ManusAuth, type ManusSession } from '../../manus-auth.js'
import { createLeaderboardClient, type LeaderboardClient, type RunTicket } from '../../leaderboard.js'
import type { SaveData } from '../engine/save'

/**
 * Online layer: Manus account session, shop/entitlements, Stripe Checkout round trip, cloud save
 * and online leaderboards. Everything here is optional — the game stays fully playable offline or
 * logged out, and every server answer is re-checked server-side (ownership comes from the session).
 */
export type ProductId = 'skins_pack' | 'season_plus' | 'feathers_500' | 'swoop_club'
export type FeatherItemId = 'skin_albino' | 'skin_golden' | 'skin_night' | 'bonus_egg'
export type Product = { id: ProductId; kind: 'one_time' | 'consumable' | 'subscription'; name: string; description: string; amount: number; interval: string | null }
export type Catalog = { currency: string; products: Product[]; featherItems: { id: FeatherItemId; cost: number }[]; paymentsEnabled: boolean }
export type Membership = { active: boolean; status: string; renewsAt: string | null; cancelAtPeriodEnd: boolean }
export type PlayerState = { owned: string[]; feathers: number; bonusEggs: number; membership: Membership; monthlySkin: string }
export type Order = { id: number; product: string; name: string; kind: string; status: 'paid' | 'failed' | 'processing'; amount: number | null; currency: string; at: string }
export type BoardId = 'season-v1' | 'endless-v1'
export type BoardEntry = { rank: number; name: string; score: number; member: boolean; me: boolean }
export type CheckoutReturn = { kind: 'success' | 'cancel'; sessionId: string | null }

const EMPTY: PlayerState = { owned: [], feathers: 0, bonusEggs: 0, membership: { active: false, status: 'none', renewsAt: null, cancelAtPeriodEnd: false }, monthlySkin: '' }

/** Fields of the local save that follow the player across devices. */
const SYNCED: (keyof SaveData)[] = ['musicVolume', 'sfxVolume', 'callsVolume', 'muted', 'sensitivity', 'invertY', 'reducedMotion', 'tutorialDone', 'playerName', 'leaderboard', 'skins', 'location', 'mode']

export function requestId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export function formatPrice(cents: number | null, currency = 'AUD'): string {
  if (cents == null) return ''
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(cents / 100) + (currency === 'AUD' ? '' : ` ${currency}`)
}

export function errorCode(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  if (/online_preview_requires_checkpoint/.test(msg)) return 'offline'
  if (/UNAUTHORIZED|login|401/i.test(msg)) return 'login_required'
  const m = msg.match(/[a-z]+(?:_[a-z]+)+/)
  return m ? m[0] : 'network'
}

export class Online extends EventTarget {
  session: ManusSession = { status: 'logged_out', user: null }
  state: PlayerState = EMPTY
  catalog: Catalog | null = null
  private boards = new Map<BoardId, LeaderboardClient>()
  private saveTimer = 0
  private pendingSave: Partial<SaveData> | null = null

  get signedIn(): boolean {
    return this.session.status === 'authenticated'
  }

  get offline(): boolean {
    return this.session.status === 'offline'
  }

  get embedded(): boolean {
    try {
      return window.self !== window.top
    } catch {
      return true
    }
  }

  owns(sku: string): boolean {
    return this.state.owned.includes(sku)
  }

  get seasonPlus(): boolean {
    return this.owns('season_plus')
  }

  private changed(): void {
    this.dispatchEvent(new Event('change'))
  }

  /** Start-up: read the real session (never assumed), then load catalog and player state. */
  async prepare(): Promise<void> {
    window.addEventListener('manus-auth-change', e => {
      this.session = e.detail
      if (!this.signedIn) this.state = EMPTY
      this.changed()
      if (this.signedIn) void this.refresh()
    })
    try {
      this.session = await ManusAuth.prepare()
    } catch {
      this.session = { status: 'offline', user: null }
    }
    this.changed()
    void this.loadCatalog()
    if (this.signedIn) await this.refresh()
  }

  async loadCatalog(): Promise<Catalog | null> {
    if (this.catalog || this.offline) return this.catalog
    try {
      this.catalog = await ManusAuth.query<Catalog>('shop.catalog')
      this.changed()
    } catch {
      this.catalog = null
    }
    return this.catalog
  }

  async refresh(): Promise<void> {
    if (!this.signedIn) return
    try {
      this.state = await ManusAuth.query<PlayerState>('shop.state')
      this.changed()
    } catch {
      // Keep the last known state; the UI shows what it has.
    }
  }

  /** Must be called directly from a click/tap handler (login may open the standalone game). */
  login(): void {
    void ManusAuth.login().catch(() => this.changed())
  }

  async logout(): Promise<void> {
    this.session = await ManusAuth.logout()
    this.state = EMPTY
    this.changed()
  }

  openStandalone(): void {
    ManusAuth.open_standalone()
  }

  /** Create a Stripe Checkout Session and send the player there (top-level page only). */
  async checkout(product: ProductId): Promise<void> {
    const returnUrl = `${location.origin}${location.pathname}`
    const { url } = await ManusAuth.mutate<{ url: string; sessionId: string }>('shop.checkout', { product, returnUrl })
    location.assign(url)
  }

  /** Read and clear ?checkout=… from the address bar after returning from Stripe. */
  takeCheckoutReturn(): CheckoutReturn | null {
    const params = new URLSearchParams(location.search)
    const kind = params.get('checkout')
    if (kind !== 'success' && kind !== 'cancel') return null
    const sessionId = params.get('session_id')
    params.delete('checkout')
    params.delete('session_id')
    const qs = params.toString()
    history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`)
    return { kind, sessionId: sessionId && /^cs_[A-Za-z0-9_]+$/.test(sessionId) ? sessionId : null }
  }

  /**
   * After a successful return, wait for the signed webhook to fulfil the order. The return URL
   * itself proves nothing; only the server's order status (written by the webhook) does.
   */
  async awaitOrder(sessionId: string, timeoutMs = 45_000): Promise<'paid' | 'failed' | 'processing'> {
    const until = Date.now() + timeoutMs
    let wait = 1000
    while (Date.now() < until) {
      try {
        const r = await ManusAuth.query<{ status: string }>('shop.orderStatus', { sessionId })
        if (r.status === 'paid' || r.status === 'failed') {
          await this.refresh()
          return r.status
        }
      } catch {
        // transient; keep polling
      }
      await new Promise(res => setTimeout(res, wait))
      wait = Math.min(4000, wait * 1.4)
    }
    await this.refresh()
    return 'processing'
  }

  async orders(): Promise<Order[]> {
    return ManusAuth.query<Order[]>('shop.orders')
  }

  async spend(item: FeatherItemId): Promise<void> {
    const r = await ManusAuth.mutate<{ applied: boolean; state: PlayerState }>('shop.spend', { item, requestId: requestId() })
    this.state = r.state
    this.changed()
  }

  /** Consume one bonus egg for the run about to start. Resolves false when none could be used. */
  async useBonusEgg(): Promise<boolean> {
    if (!this.signedIn || this.state.bonusEggs < 1) return false
    try {
      const r = await ManusAuth.mutate<{ applied: boolean }>('shop.useBonusEgg', { requestId: requestId() })
      this.state = { ...this.state, bonusEggs: Math.max(0, this.state.bonusEggs - 1) }
      this.changed()
      return r.applied
    } catch {
      return false
    }
  }

  async setMembershipCancel(cancel: boolean): Promise<void> {
    this.state = await ManusAuth.mutate<PlayerState>(cancel ? 'shop.cancelMembership' : 'shop.resumeMembership')
    this.changed()
  }

  async billingPortal(): Promise<void> {
    const { url } = await ManusAuth.mutate<{ url: string }>('shop.billingPortal', { returnUrl: `${location.origin}${location.pathname}` })
    location.assign(url)
  }

  // ─── cloud save ─────────────────────────────────────────────────────────

  /** Pull the cloud save; returns the synced fields to merge into the local save, if any. */
  async pullSave(): Promise<Partial<SaveData> | null> {
    if (!this.signedIn) return null
    try {
      const r = await ManusAuth.query<{ data: Record<string, unknown>; updatedAt: string } | null>('save.get')
      return r?.data ? (r.data as Partial<SaveData>) : null
    } catch {
      return null
    }
  }

  /** Debounced push of the synced fields. */
  pushSave(data: SaveData): void {
    if (!this.signedIn) return
    const out: Record<string, unknown> = { version: 1 }
    for (const k of SYNCED) out[k] = data[k]
    this.pendingSave = out as Partial<SaveData>
    window.clearTimeout(this.saveTimer)
    this.saveTimer = window.setTimeout(() => {
      const payload = this.pendingSave
      this.pendingSave = null
      if (payload) void ManusAuth.mutate('save.put', { data: payload }).catch(() => undefined)
    }, 1500)
  }

  // ─── leaderboards ───────────────────────────────────────────────────────

  private board(id: BoardId): LeaderboardClient {
    let b = this.boards.get(id)
    if (!b) {
      // ManusAuth scopes procedure names to the game router (leaderboard.* → game.leaderboard.*).
      b = createLeaderboardClient({ identity: 'account', boardId: id, rulesVersion: 'v1', auth: ManusAuth })
      this.boards.set(id, b)
    }
    return b
  }

  /** Ask the server for a run ticket at run start (signed-in players only). */
  async beginRun(id: BoardId): Promise<RunTicket | null> {
    if (!this.signedIn) return null
    const r = await this.board(id).beginRun().catch(() => null)
    return r && r.ok ? r.value : null
  }

  /** Submit a finished run and claim its feathers. */
  async submitRun(id: BoardId, ticket: RunTicket, score: number, durationMs: number): Promise<{ ok: boolean; feathers: number; error?: string }> {
    const b = this.board(id)
    let r = await b.submitRun(ticket, score, durationMs).catch(() => null)
    if (!r || !r.ok) r = await b.retryRun(ticket).catch(() => null)
    if (!r || !r.ok) return { ok: false, feathers: 0, error: r && !r.ok ? r.error : 'network' }
    let feathers = 0
    try {
      const claim = await ManusAuth.mutate<{ feathers: number }>('shop.claimRunFeathers', { runId: r.value.receipt.runId })
      feathers = claim.feathers
      await this.refresh()
    } catch {
      // The score still counts; feathers can be claimed again later with the same run id.
    }
    return { ok: true, feathers }
  }

  async boardEntries(id: BoardId, period: 'all' | 'week'): Promise<BoardEntry[]> {
    const r = await ManusAuth.query<{ entries: BoardEntry[] }>('boards.get', { boardId: id, period })
    return r.entries
  }
}
