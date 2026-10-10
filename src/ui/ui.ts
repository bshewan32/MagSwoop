import type { Audio } from '../engine/audio'
import type { I18n } from '../engine/i18n'
import type { Input } from '../engine/input'
import { insertScore, type Quality, type SaveData, type SaveStore } from '../engine/save'
import { CONFIG } from '../game/config'
import type { Hint, HudStatus, Point, PopupKind } from '../game/game'
import { formatClock, stars, type RunState } from '../game/rules'
import bootIcon from '../../assets/share/favicon.png'
import { SKINS, VARIANTS, skinById } from '../game/magpies'
import { errorCode, formatPrice, type BoardId, type FeatherItemId, type Online, type ProductId } from '../online/online'

export type Screen = 'boot' | 'title' | 'hud' | 'pause' | 'settings' | 'leaderboard' | 'results' | 'shop' | 'wardrobe' | 'account'

export type UiActions = {
  play(): void
  resume(): void
  restart(): void
  quit(): void
  settings(patch: Partial<SaveData>): void
  /** Equipped skins changed (per flock bird). */
  skins(skins: (string | null)[]): void
}

type BoardTab = 'local' | BoardId
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

const SKIN_MONTHLY = ['skin_aurora', 'skin_sunset', 'skin_frost']

const magpieHead = (main: string, accent: string) =>
  `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 17 11 13.5 11 19Z" fill="#dfe3e8" stroke="#141418" stroke-width="1.2"/><circle cx="17" cy="16" r="9" fill="${main}" stroke="#141418" stroke-width="1.6"/><path d="M21 8.5a9 9 0 0 1 4.8 10.5L19 15Z" fill="${accent}"/><circle cx="14.5" cy="14" r="1.8" fill="#9a2f17"/></svg>`

const ICON = {
  logo: '<svg viewBox="0 0 64 40" aria-hidden="true"><path d="M2 14C14 6 24 10 30 18 36 10 50 4 62 10 52 12 44 18 38 24L44 25 36 29C32 34 24 34 20 29L10 32 16 25C10 22 6 18 2 14Z" fill="#141418" stroke="#fff7e8" stroke-width="2" stroke-linejoin="round"/><path d="M30 18C34 14 44 10 52 11 45 14 40 18 37 22Z" fill="#f3f1ea"/><path d="M38 24 44 25 36 29Z" fill="#dfe3e8"/><circle cx="40.5" cy="22.5" r="1.3" fill="#ff5a3c"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8 5.7 21.4l1.5-7.1L1.8 9.4 9 8.6Z" fill="currentColor"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 20 20 12 15 4 20Z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="5" height="16" rx="1.5" fill="currentColor"/><rect x="14" y="4" width="5" height="16" rx="1.5" fill="currentColor"/></svg>',
  egg: '<svg viewBox="0 0 20 26" aria-hidden="true"><path d="M10 1C4.5 1 1 9.5 1 15.5 1 21 5 25 10 25s9-4 9-9.5C19 9.5 15.5 1 10 1Z" fill="currentColor" stroke="#1b1838" stroke-width="2"/><path class="crack" d="M2.5 13 6 15.5 8.5 12 11.5 16 14 12.5 17.5 15" fill="none" stroke="#1b1838" stroke-width="2"/><circle cx="7" cy="9" r="1.4" fill="#6b5a3e" opacity=".6"/><circle cx="12.5" cy="19" r="1.1" fill="#6b5a3e" opacity=".6"/></svg>',
  note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6.5" cy="18" r="3" fill="currentColor"/><circle cx="17.5" cy="16" r="3" fill="currentColor"/></svg>',
  feather: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 3C11 4 5 10 4 20l2 1c1-3 3-6 5-7l-2-1 5-1-2-1 5-3-3-1c3-1 5-2 6-4Z" fill="currentColor"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2.5" fill="currentColor"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>',
  crown: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5Z" fill="currentColor"/></svg>',
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4.2" fill="currentColor"/><path d="M3.5 21c1.2-4.6 4.4-7 8.5-7s7.3 2.4 8.5 7Z" fill="currentColor"/></svg>',
}

/** Glyphs for control hints, per input method. */
const GLYPH = {
  keyboard: { keys: '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>', swoop: '<kbd>F</kbd>', call: '<kbd>E</kbd>', switch: '<kbd>Q</kbd>', boost: '<kbd class="wide">Shift</kbd>', select: '<kbd>Enter</kbd>', back: '<kbd>Esc</kbd>' },
  gamepad: { keys: '<kbd class="round">L</kbd>', swoop: '<kbd class="round x">X</kbd>', call: '<kbd class="round y">Y</kbd>', switch: '<kbd class="round">LB</kbd>', boost: '<kbd class="round">RB</kbd>', select: '<kbd class="round a">A</kbd>', back: '<kbd class="round b">B</kbd>' },
}

/**
 * DOM game UI: title, HUD, pause, settings, results and high scores as HTML/CSS layered over the
 * canvas. Every screen is keyboard-, gamepad- and touch-navigable; text comes from i18n keys.
 */
export class Ui {
  screen: Screen = 'boot'
  private readonly root: HTMLElement
  private readonly stack: Screen[] = []
  private hudCache = new Map<string, string>()
  private hintKey: Hint | null = null
  private navRepeat = 0
  private lastRun?: RunState
  private savedRank = -1
  private lastMethod = ''
  private lastEggs = -1
  private boardTab: BoardTab = 'local'
  private boardPeriod: 'all' | 'week' = 'all'
  private shopMessage = ''
  private shopTone: 'good' | 'bad' | '' = ''
  private busy = false
  private onlineResult = ''
  /** Use one bonus egg on the next run (title-screen toggle, shown when the player has some). */
  wantsBonusEgg = false

  constructor(
    private readonly i18n: I18n,
    private readonly save: SaveStore,
    private readonly audio: Audio,
    private readonly input: Input,
    private readonly actions: UiActions,
    private readonly online: Online,
  ) {
    this.root = document.getElementById('ui')!
    this.root.innerHTML = this.template()
    this.root.addEventListener('click', e => this.onClick(e))
    this.root.addEventListener('input', e => this.onInput(e))
    this.root.addEventListener('focusin', e => {
      if ((e.target as HTMLElement).matches('.btn, .seg button, .toggle')) this.audio.play('ui')
    })
    window.addEventListener('keydown', e => this.onKey(e))
    this.online.addEventListener('change', () => this.renderOnline())
    this.translate()
    this.refreshSettings()
  }

  // ─── screens ────────────────────────────────────────────────────────────

  show(screen: Screen): void {
    this.stack.length = 0
    this.setScreen(screen)
  }

  /** Open an overlay screen (settings, high scores) that returns to the current one on Back. */
  push(screen: Screen): void {
    this.stack.push(this.screen)
    this.setScreen(screen)
  }

  back(): void {
    const prev = this.stack.pop()
    if (prev) this.setScreen(prev)
    else if (this.screen === 'pause') this.actions.resume()
  }

  private setScreen(screen: Screen): void {
    this.screen = screen
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-screen]')) {
      const active = el.dataset.screen === screen || (el.dataset.screen === 'hud' && (screen === 'pause' || screen === 'results' || (screen === 'settings' && this.stack.includes('pause'))))
      el.classList.toggle('is-active', active)
      el.setAttribute('aria-hidden', String(!active))
    }
    this.root.dataset.activeScreen = screen
    if (screen === 'title') {
      this.renderBest()
      this.renderSetup()
    }
    if (screen === 'leaderboard') this.renderLeaderboard()
    if (screen === 'shop') {
      this.renderShop()
      void this.online.loadCatalog().then(() => this.renderShop())
      void this.online.refresh()
    }
    if (screen === 'wardrobe') this.renderWardrobe()
    if (screen === 'account') {
      this.renderAccount()
      void this.loadOrders()
    }
    if (screen === 'hud') this.lastEggs = -1
    // Focus the first control so keyboard and gamepad players can act immediately.
    requestAnimationFrame(() => {
      const first = this.navItems()[0]
      if (first && this.input.method !== 'touch') first.focus({ preventScroll: true })
      else (document.activeElement as HTMLElement | null)?.blur?.()
    })
  }

  setBootProgress(progress: number): void {
    const bar = this.q<HTMLElement>('.boot-bar i')
    bar.style.transform = `scaleX(${Math.max(0.04, Math.min(1, progress))})`
  }

  // ─── HUD ────────────────────────────────────────────────────────────────

  updateHud(run: RunState, hud: HudStatus): void {
    this.set('score', run.score.toLocaleString('en'))
    this.set('clock', formatClock(run.timeLeft))
    this.q('.hud-clock').classList.toggle('is-low', run.timeLeft <= 20)

    if (run.eggs !== this.lastEggs) {
      const eggs = this.q('.hud-eggs')
      const clutch = Math.max(CONFIG.run.eggs, run.eggs)
      if (eggs.childElementCount < clutch || (run.elapsed < 0.5 && eggs.childElementCount !== clutch)) eggs.innerHTML = `<span class="hud-egg">${ICON.egg}</span>`.repeat(clutch)
      for (const [i, egg] of this.qa('.hud-egg').entries()) egg.classList.toggle('is-lost', i >= run.eggs)
      this.lastEggs = run.eggs
    }

    const combo = this.q('.hud-combo')
    combo.classList.toggle('is-active', run.combo > 1)
    if (run.combo > 1) {
      if (this.set('combo', `×${run.combo}`)) {
        combo.classList.remove('pop')
        void combo.offsetWidth
        combo.classList.add('pop')
      }
      this.q<HTMLElement>('.hud-combo-bar i').style.transform = `scaleX(${run.comboTimer / CONFIG.score.comboWindow})`
    }

    for (const card of this.qa('.hud-flock .flock-card')) {
      const b = hud.flock[Number(card.dataset.bird)]
      if (!b) continue
      card.classList.toggle('is-active', b.active)
      card.classList.toggle('is-tired', b.tired)
      card.classList.toggle('is-resting', b.mode === 'perch' && !b.active)
      ;(card.querySelector('.flock-bar i') as HTMLElement).style.transform = `scaleX(${b.stamina.toFixed(3)})`
    }

    const carolEl = this.q('.hud-carol')
    carolEl.classList.toggle('is-ready', hud.carolReady >= 1)
    carolEl.classList.toggle('is-active', hud.carolActive)
    carolEl.style.setProperty('--ready', `${Math.min(1, hud.carolReady) * 360}deg`)

    const compass = this.q<HTMLElement>('.hud-compass')
    compass.classList.toggle('is-hidden', !hud.intruder)
    if (hud.intruder) {
      this.q<HTMLElement>('.hud-compass-arrow').style.transform = `rotate(${-hud.intruder.angle}rad)`
      this.set('distance', this.i18n.t('hud.intruder', { m: Math.round(hud.intruder.distance) }))
    }

    const reticle = this.q<HTMLElement>('.reticle')
    reticle.classList.toggle('is-visible', !!hud.lock)
    if (hud.lock) {
      reticle.style.transform = `translate(${hud.lock.x}px, ${hud.lock.y}px)`
      reticle.classList.toggle('is-locked', hud.lock.locked)
    }
  }

  popup(text: string, at: Point, kind: PopupKind): void {
    const el = document.createElement('div')
    el.className = `popup popup-${kind}`
    el.textContent = text
    el.style.left = `${at.x}px`
    el.style.top = `${at.y}px`
    this.q('.popups').append(el)
    el.addEventListener('animationend', () => el.remove())
  }

  hurt(): void {
    const v = this.q('.hurt-vignette')
    v.classList.remove('flash')
    void (v as HTMLElement).offsetWidth
    v.classList.add('flash')
  }

  hint(hint: Hint | null): void {
    this.hintKey = hint
    this.renderHint()
  }

  private renderHint(): void {
    const el = this.q('.hint')
    const hint = this.hintKey
    if (!hint) {
      el.classList.remove('is-active')
      return
    }
    const method = this.input.method
    const glyph = method === 'gamepad' ? GLYPH.gamepad : GLYPH.keyboard
    const key = hint === 'nest' ? 'hint.nest' : `hint.${hint}.${method}`
    el.querySelector('span')!.innerHTML = this.i18n.t(key, { keys: glyph.keys, swoop: glyph.swoop, call: glyph.call, switch: glyph.switch, boost: glyph.boost })
    el.classList.add('is-active')
  }

  banner(key: string, tone: 'good' | 'bad' = 'bad'): void {
    const el = this.q('.banner')
    el.textContent = this.i18n.t(key)
    el.dataset.tone = tone
    el.classList.remove('show')
    void (el as HTMLElement).offsetWidth
    el.classList.add('show')
  }

  // ─── results ────────────────────────────────────────────────────────────

  showResults(run: RunState): void {
    this.lastRun = run
    this.savedRank = -1
    const won = run.phase === 'won'
    const el = this.q('[data-screen="results"]')
    el.classList.toggle('is-won', won)
    this.q('.results-title').setAttribute('data-i18n', won ? 'results.won' : 'results.lost')
    const n = stars(run)
    for (const [i, s] of this.qa('.results-stars .star').entries()) {
      s.classList.toggle('is-on', i < n)
      ;(s as HTMLElement).style.animationDelay = `${0.35 + i * 0.22}s`
    }
    const fmt = (v: number) => v.toLocaleString('en')
    this.q('.r-scares').textContent = fmt(run.scares)
    this.q('.r-hits').textContent = fmt(run.hits)
    const split = [['cyclists', run.cyclists], ['runners', run.runners], ['surfers', run.surfers], ['scooters', run.scooters]]
      .filter(([, n]) => (n as number) > 0).map(([k, n]) => this.i18n.t(`results.split.${k}`, { n: n as number }))
    this.q('.r-people').textContent = split.join(' · ') || '0'
    this.q('.r-defended').textContent = fmt(run.defended)
    this.q('.r-combo').textContent = `×${run.bestCombo}`
    this.q('.r-eggs').textContent = run.mode === 'endless' ? this.i18n.t('results.endlessTime', { t: formatClock(run.elapsed) }) : `${run.eggs} / ${CONFIG.run.eggs}`
    this.q('.r-egg-bonus').textContent = `+${fmt(run.eggBonus)}`
    this.q('.r-total').textContent = fmt(run.score)
    const best = this.save.data.leaderboard[0]?.score ?? 0
    this.q('.results-best').classList.toggle('is-active', !run.unranked && run.score > best && run.score > 0)
    const form = this.q('.results-save')
    form.classList.toggle('is-hidden', run.unranked || run.score <= 0 || insertScore(this.save.data.leaderboard, this.entry(run)).rank < 0)
    form.classList.remove('is-saved')
    this.q<HTMLInputElement>('.results-name').value = this.save.data.playerName
    this.q('.results-rank').textContent = ''
    this.onlineResult = run.unranked ? 'results.online.unranked' : this.online.signedIn ? 'results.online.sending' : this.online.offline ? '' : 'results.online.login'
    this.renderOnlineResult()
    this.translate()
    this.show('results')
  }

  /** Called by main.ts when the online submission finishes. */
  onlineSubmitted(r: { ok: boolean; feathers: number } | null): void {
    if (!r) this.onlineResult = this.online.signedIn ? 'results.online.failed' : this.onlineResult
    else this.onlineResult = r.ok ? (r.feathers > 0 ? 'results.online.feathers' : 'results.online.posted') : 'results.online.failed'
    this.lastFeathers = r?.feathers ?? 0
    this.renderOnlineResult()
  }

  private lastFeathers = 0
  private renderOnlineResult(): void {
    const el = this.q('.results-online')
    el.classList.toggle('is-hidden', !this.onlineResult)
    el.querySelector('span')!.textContent = this.onlineResult ? this.i18n.t(this.onlineResult, { n: this.lastFeathers }) : ''
    el.querySelector('button')!.classList.toggle('is-hidden', this.onlineResult !== 'results.online.login')
  }

  private entry(run: RunState) {
    return { name: this.q<HTMLInputElement>('.results-name')?.value.trim().slice(0, 16) || this.save.data.playerName, score: run.score, seconds: Math.round(run.elapsed), at: Date.now() }
  }

  private saveScore(): void {
    if (!this.lastRun || this.lastRun.unranked || this.savedRank >= 0) return
    const entry = this.entry(this.lastRun)
    const { board, rank } = insertScore(this.save.data.leaderboard, entry)
    this.save.update({ leaderboard: board, playerName: entry.name })
    this.savedRank = rank
    this.q('.results-save').classList.add('is-saved')
    this.q('.results-rank').textContent = rank >= 0 ? this.i18n.t('results.rank', { rank: rank + 1 }) : ''
    this.audio.play('ui')
  }

  private renderLeaderboard(): void {
    for (const b of this.qa<HTMLButtonElement>('.board-tabs button')) b.setAttribute('aria-pressed', String(b.dataset.tab === this.boardTab))
    for (const b of this.qa<HTMLButtonElement>('.board-period button')) b.setAttribute('aria-pressed', String(b.dataset.period === this.boardPeriod))
    this.q('.board-period').classList.toggle('is-hidden', this.boardTab === 'local')
    this.q('.board-head span[data-i18n="leaderboard.time"]').classList.toggle('is-hidden', this.boardTab !== 'local')
    if (this.boardTab !== 'local') {
      void this.renderOnlineBoard(this.boardTab)
      return
    }
    const list = this.q('.board')
    const board = this.save.data.leaderboard
    if (board.length === 0) {
      list.innerHTML = `<li class="board-empty">${this.i18n.t('leaderboard.empty')}</li>`
      return
    }
    list.innerHTML = board
      .map((e, i) => `<li class="${i === this.savedRank ? 'is-me' : ''}"><b>${i + 1}</b><span class="board-name"></span><span>${formatClock(e.seconds)}</span><em>${e.score.toLocaleString('en')}</em></li>`)
      .join('')
    // Names are player-entered text: assign via textContent, never innerHTML.
    list.querySelectorAll('.board-name').forEach((el, i) => (el.textContent = board[i].name))
  }

  private async renderOnlineBoard(id: BoardId): Promise<void> {
    const list = this.q('.board')
    if (this.online.offline) {
      list.innerHTML = `<li class="board-empty">${esc(this.i18n.t('online.offline'))}</li>`
      return
    }
    list.innerHTML = `<li class="board-empty">${esc(this.i18n.t('online.loading'))}</li>`
    const period = this.boardPeriod
    try {
      const entries = await this.online.boardEntries(id, period)
      if (this.boardTab !== id || this.boardPeriod !== period) return
      if (!entries.length) {
        list.innerHTML = `<li class="board-empty">${esc(this.i18n.t('leaderboard.emptyOnline'))}</li>`
        return
      }
      list.innerHTML = entries.map(e => `<li class="${e.me ? 'is-me' : ''}"><b>${e.rank}</b><span class="board-name"></span>${e.member ? `<span class="badge-club" title="${esc(this.i18n.t('club.badge'))}">${ICON.crown}</span>` : '<span></span>'}<em>${e.score.toLocaleString('en')}</em></li>`).join('')
      list.querySelectorAll('.board-name').forEach((el, i) => (el.textContent = entries[i].name))
    } catch {
      if (this.boardTab === id) list.innerHTML = `<li class="board-empty">${esc(this.i18n.t('online.error'))}</li>`
    }
  }

  // ─── online: account chip, setup, shop, wardrobe, account ───────────────

  private renderOnline(): void {
    const chip = this.q('.account-chip')
    const o = this.online
    chip.classList.toggle('is-hidden', o.offline)
    if (o.signedIn) {
      chip.innerHTML = `${ICON.user}<span class="chip-name"></span>${o.state.membership.active ? `<span class="badge-club">${ICON.crown}</span>` : ''}<span class="chip-feathers">${ICON.feather}<b>${o.state.feathers.toLocaleString('en')}</b></span>`
      chip.querySelector('.chip-name')!.textContent = o.session.user?.name ?? this.i18n.t('account.player')
    } else {
      chip.innerHTML = `${ICON.user}<span>${esc(this.i18n.t('account.login'))}</span>`
    }
    if (this.screen === 'title') this.renderSetup()
    if (this.screen === 'shop') this.renderShop()
    if (this.screen === 'wardrobe') this.renderWardrobe()
    if (this.screen === 'account') this.renderAccount()
  }

  /** Mode and location buttons on the title screen (Season+ options show a lock). */
  private renderSetup(): void {
    const d = this.save.data
    const plus = this.online.seasonPlus
    const mode = this.q('[data-action="cycle-mode"]')
    mode.innerHTML = `<span>${esc(this.i18n.t(`mode.${d.mode}`))}</span>${!plus && d.mode !== 'classic' ? ICON.lock : ''}`
    const loc = this.q('[data-action="cycle-location"]')
    loc.innerHTML = `<span>${esc(this.i18n.t(`location.${d.location}`))}</span>${!plus && d.location !== 'park' ? ICON.lock : ''}`
    const egg = this.q('[data-action="toggle-egg"]')
    const eggs = this.online.signedIn ? this.online.state.bonusEggs : 0
    if (eggs < 1) this.wantsBonusEgg = false
    egg.classList.toggle('is-hidden', eggs < 1)
    egg.setAttribute('aria-pressed', String(this.wantsBonusEgg))
    egg.innerHTML = `<span class="egg-icon">${ICON.egg}</span><span>${esc(this.i18n.t(this.wantsBonusEgg ? 'setup.eggOn' : 'setup.eggOff', { n: eggs }))}</span>`
  }

  private flash(message: string, tone: 'good' | 'bad' | '' = ''): void {
    this.shopMessage = message
    this.shopTone = tone
    for (const el of this.qa('.store-message')) {
      el.textContent = message ? this.i18n.t(message) : ''
      el.dataset.tone = tone
    }
  }

  /** Message shown in place of buy buttons when buying is not possible here. */
  private storeGate(): string {
    const o = this.online
    if (o.offline) return `<div class="store-gate"><p>${esc(this.i18n.t('online.offline'))}</p></div>`
    if (!o.signedIn) return `<div class="store-gate"><p>${esc(this.i18n.t('shop.loginToBuy'))}</p><button data-nav class="btn btn-small btn-primary" data-action="login"><span>${esc(this.i18n.t('account.login'))}</span></button></div>`
    if (o.embedded) return `<div class="store-gate"><p>${esc(this.i18n.t('shop.openTab'))}</p><button data-nav class="btn btn-small btn-primary" data-action="standalone"><span>${esc(this.i18n.t('shop.openTabButton'))}</span></button></div>`
    if (o.catalog && !o.catalog.paymentsEnabled) return `<div class="store-gate"><p>${esc(this.i18n.t('shop.unavailable'))}</p></div>`
    return ''
  }

  private renderShop(): void {
    const o = this.online
    const cat = o.catalog
    const owned = (id: ProductId) => (id === 'skins_pack' ? ['skin_albino', 'skin_golden', 'skin_night'].every(s => o.owns(s)) : id === 'season_plus' ? o.seasonPlus : id === 'swoop_club' ? o.state.membership.active : false)
    const gate = this.storeGate()
    const canBuy = !gate
    const cards = (cat?.products ?? []).map(p => {
      const have = owned(p.id)
      const price = `${formatPrice(p.amount, cat?.currency)}${p.interval ? ` / ${esc(this.i18n.t(`shop.per.${p.interval}`))}` : ''}`
      const btn = have
        ? `<span class="product-owned">${esc(this.i18n.t(p.kind === 'subscription' ? 'shop.member' : 'shop.owned'))}</span>`
        : canBuy ? `<button data-nav class="btn btn-small ${p.kind === 'subscription' ? 'btn-primary' : ''}" data-action="buy" data-product="${p.id}"><span>${esc(this.i18n.t(p.kind === 'subscription' ? 'shop.join' : 'shop.buy'))}</span></button>` : ''
      return `<article class="product product-${p.id}"><div class="product-art">${this.productArt(p.id)}</div><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p><div class="product-foot"><b>${price}</b>${btn}</div></article>`
    }).join('')
    const items = (cat?.featherItems ?? []).map(i => {
      const skin = skinById(i.id)
      const have = skin ? o.owns(i.id) : false
      const label = skin ? this.i18n.t(skin.nameKey) : this.i18n.t('shop.bonusEgg')
      const extra = !skin ? `<small>${esc(this.i18n.t('shop.bonusEggHave', { n: o.state.bonusEggs }))}</small>` : ''
      const btn = have ? `<span class="product-owned">${esc(this.i18n.t('shop.owned'))}</span>`
        : o.signedIn && !o.offline ? `<button data-nav class="btn btn-small" data-action="spend" data-item="${i.id}" ${o.state.feathers < i.cost ? 'data-short="1"' : ''}><span>${ICON.feather}${i.cost}</span></button>` : `<span class="product-price">${ICON.feather}${i.cost}</span>`
      return `<div class="feather-item">${skin ? `<span class="swatch" style="--a:${skin.swatch[0]};--b:${skin.swatch[1]}"></span>` : `<span class="swatch swatch-egg">${ICON.egg}</span>`}<span class="feather-name">${esc(label)}${extra}</span>${btn}</div>`
    }).join('')
    this.q('.shop-body').innerHTML = `
      ${gate}
      <div class="products">${cards || `<p class="board-empty">${esc(this.i18n.t(o.offline ? 'online.offline' : 'online.loading'))}</p>`}</div>
      <h3 class="shop-sub">${ICON.feather}<span>${esc(this.i18n.t('shop.featherShop'))}</span>${o.signedIn ? `<b class="shop-balance">${o.state.feathers.toLocaleString('en')}</b>` : ''}</h3>
      <p class="shop-note">${esc(this.i18n.t('shop.earn'))}</p>
      <div class="feather-items">${items}</div>
      <p class="shop-note shop-test">${esc(this.i18n.t('shop.testMode'))}</p>`
    this.flash(this.shopMessage, this.shopTone)
  }

  private productArt(id: ProductId): string {
    if (id === 'skins_pack') return ['skin_albino', 'skin_golden', 'skin_night'].map(k => { const sk = skinById(k)!; return magpieHead(sk.swatch[0], sk.swatch[1]) }).join('')
    if (id === 'season_plus') return '<svg viewBox="0 0 64 32" aria-hidden="true"><rect width="64" height="32" rx="6" fill="#ecd9a8"/><path d="M0 22c8-4 16 4 24 0s16-4 24 0 12 2 16 0v10H0Z" fill="#2b8db3"/><path d="M0 25c8-3 16 3 24 0s16-3 24 0 12 2 16 0" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M14 6v14M10 9l4-3 4 3M8 12l6-3 6 3" stroke="#2f5d3a" stroke-width="2.2" fill="none"/><text x="46" y="17" font-size="12" font-weight="900" fill="#141418" text-anchor="middle">∞</text></svg>'
    if (id === 'feathers_500') return `<span class="art-feathers">${ICON.feather}${ICON.feather}${ICON.feather}</span>`
    return `<span class="art-club">${ICON.crown}</span>`
  }

  private renderWardrobe(): void {
    const o = this.online
    const equipped = this.save.data.skins
    const available = (id: string) => o.owns(id)
    this.q('.wardrobe-body').innerHTML = VARIANTS.map((v, bi) => {
      const options = [null, ...SKINS.map(sk => sk.id)].map(id => {
        const sk = skinById(id)
        const on = (equipped[bi] ?? null) === id
        const ok = id === null || available(id)
        const main = sk ? sk.swatch[0] : v.swatch[0]
        const accent = sk ? sk.swatch[1] : v.swatch[1]
        const name = sk ? this.i18n.t(sk.nameKey) : this.i18n.t('wardrobe.natural')
        const tag = sk && !ok ? (sk.id === 'skin_crested' || SKIN_MONTHLY.includes(sk.id) ? this.i18n.t('wardrobe.clubOnly') : this.i18n.t('wardrobe.locked')) : ''
        return `<button data-nav class="skin-opt ${on ? 'is-on' : ''} ${ok ? '' : 'is-locked'}" data-action="equip" data-bird="${bi}" data-skin="${id ?? ''}" aria-pressed="${on}" title="${esc(name)}"><span class="skin-head">${magpieHead(main, accent)}</span><small>${esc(name)}</small>${tag ? `<em>${ICON.lock}${esc(tag)}</em>` : ''}</button>`
      }).join('')
      return `<div class="wardrobe-row"><div class="wardrobe-bird"><b>${esc(this.i18n.t(v.nameKey))}</b><small>${esc(this.i18n.t(v.traitKey))}</small></div><div class="wardrobe-opts">${options}</div></div>`
    }).join('') + `<p class="shop-note">${esc(this.i18n.t(o.signedIn ? 'wardrobe.note' : 'wardrobe.loginNote'))}</p>`
  }

  private renderAccount(): void {
    const o = this.online
    const m = o.state.membership
    const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
    let club = ''
    if (m.active) {
      club = `<p>${esc(this.i18n.t(m.cancelAtPeriodEnd ? 'club.ends' : 'club.renews', { date: date(m.renewsAt) }))}</p>
        <div class="menu menu-row">${m.cancelAtPeriodEnd
          ? `<button data-nav class="btn btn-small btn-primary" data-action="club-resume"><span>${esc(this.i18n.t('club.resume'))}</span></button>`
          : `<button data-nav class="btn btn-small" data-action="club-cancel"><span>${esc(this.i18n.t('club.cancel'))}</span></button>`}
          ${o.embedded ? '' : `<button data-nav class="btn btn-small" data-action="portal"><span>${esc(this.i18n.t('club.billing'))}</span></button>`}</div>`
    } else {
      club = `<p>${esc(this.i18n.t(m.status === 'past_due' || m.status === 'unpaid' ? 'club.pastDue' : 'club.none'))}</p><div class="menu menu-row"><button data-nav class="btn btn-small" data-action="shop"><span>${esc(this.i18n.t('club.join'))}</span></button></div>`
    }
    const body = o.offline
      ? `<p class="store-gate">${esc(this.i18n.t('online.offline'))}</p>`
      : !o.signedIn
        ? `<div class="store-gate"><p>${esc(this.i18n.t('account.why'))}</p><button data-nav class="btn btn-primary" data-action="login"><span>${esc(this.i18n.t('account.login'))}</span></button></div>`
        : `<div class="account-grid">
            <section><h3>${ICON.user}<span class="acct-name"></span></h3>
              <dl class="acct-stats"><div><dt>${esc(this.i18n.t('account.feathers'))}</dt><dd>${ICON.feather}${o.state.feathers.toLocaleString('en')}</dd></div><div><dt>${esc(this.i18n.t('account.bonusEggs'))}</dt><dd>${o.state.bonusEggs}</dd></div><div><dt>${esc(this.i18n.t('account.seasonPlus'))}</dt><dd>${esc(this.i18n.t(o.seasonPlus ? 'account.yes' : 'account.no'))}</dd></div></dl>
              <div class="menu menu-row"><button data-nav class="btn btn-small" data-action="restore"><span>${esc(this.i18n.t('account.restore'))}</span></button><button data-nav class="btn btn-small" data-action="logout"><span>${esc(this.i18n.t('account.logout'))}</span></button></div></section>
            <section><h3>${ICON.crown}<span>${esc(this.i18n.t('club.title'))}</span></h3>${club}</section>
            <section class="acct-orders"><h3><span>${esc(this.i18n.t('account.purchases'))}</span></h3><ol class="orders"><li class="board-empty">${esc(this.i18n.t('online.loading'))}</li></ol></section>
          </div>`
    this.q('.account-body').innerHTML = body + `<p class="store-message" data-tone=""></p>`
    const n = this.root.querySelector('.acct-name')
    if (n) n.textContent = o.session.user?.name ?? this.i18n.t('account.player')
    this.flash(this.shopMessage, this.shopTone)
  }

  private async loadOrders(): Promise<void> {
    if (!this.online.signedIn) return
    try {
      const orders = await this.online.orders()
      const list = this.root.querySelector('.orders')
      if (!list) return
      list.innerHTML = orders.length
        ? orders.map(o => `<li><span class="order-name"></span><small>${esc(new Date(o.at).toLocaleDateString('en-AU'))}</small><em class="order-${o.status}">${esc(this.i18n.t(`order.${o.status}`))}</em><b>${esc(formatPrice(o.amount, o.currency))}</b></li>`).join('')
        : `<li class="board-empty">${esc(this.i18n.t('account.noPurchases'))}</li>`
      list.querySelectorAll('.order-name').forEach((el, i) => (el.textContent = orders[i].name))
    } catch {
      const list = this.root.querySelector('.orders')
      if (list) list.innerHTML = `<li class="board-empty">${esc(this.i18n.t('online.error'))}</li>`
    }
  }

  /** Show the outcome of a Stripe Checkout return (called by main.ts). */
  checkoutReturned(state: 'processing' | 'paid' | 'failed' | 'cancel' | 'waiting'): void {
    const key = { waiting: 'checkout.waiting', processing: 'checkout.processing', paid: 'checkout.paid', failed: 'checkout.failed', cancel: 'checkout.cancel' }[state]
    this.flash(key, state === 'paid' ? 'good' : state === 'waiting' || state === 'processing' ? '' : 'bad')
    if (this.screen !== 'shop') this.push('shop')
    else this.renderShop()
    if (state === 'paid') this.audio.play('win')
  }

  private async run(task: () => Promise<void>, okKey = ''): Promise<void> {
    if (this.busy) return
    this.busy = true
    this.root.classList.add('is-busy')
    try {
      await task()
      if (okKey) this.flash(okKey, 'good')
    } catch (error) {
      const code = errorCode(error)
      this.flash(`error.${['login_required', 'offline', 'already_owned', 'already_member', 'not_enough_feathers', 'no_membership', 'payments_unavailable', 'no_billing_account'].includes(code) ? code : 'generic'}`, 'bad')
    } finally {
      this.busy = false
      this.root.classList.remove('is-busy')
      if (this.screen === 'shop') this.renderShop()
      if (this.screen === 'account') this.renderAccount()
      if (this.screen === 'wardrobe') this.renderWardrobe()
    }
  }

  private equip(bird: number, skin: string | null): void {
    if (skin && !this.online.owns(skin)) {
      this.flash(this.online.signedIn ? 'wardrobe.getIt' : 'shop.loginToBuy', 'bad')
      this.push('shop')
      return
    }
    const skins = [...this.save.data.skins]
    skins[bird] = skin
    this.actions.skins(skins)
    this.renderWardrobe()
    this.audio.play('switch')
  }

  private cycle(kind: 'mode' | 'location'): void {
    const d = this.save.data
    const next = kind === 'mode' ? (d.mode === 'classic' ? 'endless' : 'classic') : (d.location === 'park' ? 'beach' : 'park')
    this.actions.settings(kind === 'mode' ? { mode: next as SaveData['mode'] } : { location: next as SaveData['location'] })
    this.renderSetup()
    if (next !== 'classic' && next !== 'park' && !this.online.seasonPlus) this.banner('setup.locked', 'bad')
  }

  private renderBest(): void {
    const best = this.save.data.leaderboard[0]?.score ?? 0
    const el = this.q('.title-best')
    el.classList.toggle('is-hidden', best <= 0)
    el.textContent = this.i18n.t('menu.best', { score: best.toLocaleString('en') })
  }

  // ─── settings ───────────────────────────────────────────────────────────

  /** Re-read the save into the Settings controls (call after changing settings outside the UI). */
  refreshSettings(): void {
    const d = this.save.data
    for (const name of ['musicVolume', 'sfxVolume', 'callsVolume', 'sensitivity'] as const) this.q<HTMLInputElement>(`[name="${name}"]`).value = String(d[name])
    for (const t of this.qa<HTMLButtonElement>('.toggle')) {
      const on = d[t.dataset.setting as 'muted' | 'invertY' | 'reducedMotion'] === true
      t.setAttribute('aria-pressed', String(on))
      t.querySelector('span')!.setAttribute('data-i18n', on ? 'settings.on' : 'settings.off')
    }
    for (const b of this.qa<HTMLButtonElement>('.seg button')) b.setAttribute('aria-pressed', String(b.dataset.value === d.quality))
    for (const r of this.qa<HTMLInputElement>('input[type="range"]')) r.style.setProperty('--fill', `${((Number(r.value) - Number(r.min)) / (Number(r.max) - Number(r.min))) * 100}%`)
    this.translate()
  }

  // ─── events ─────────────────────────────────────────────────────────────

  private onClick(e: MouseEvent): void {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action], .toggle, .seg button')
    if (!target) return
    this.audio.unlock()
    if (target.matches('.toggle')) {
      const key = target.dataset.setting as 'muted' | 'invertY' | 'reducedMotion'
      this.actions.settings({ [key]: !this.save.data[key] })
      this.refreshSettings()
      this.audio.play('ui')
      return
    }
    if (target.matches('.seg button')) {
      this.actions.settings({ quality: target.dataset.value as Quality })
      this.refreshSettings()
      this.audio.play('ui')
      return
    }
    switch (target.dataset.action) {
      case 'play': this.actions.play(); break
      case 'resume': this.actions.resume(); break
      case 'restart': this.actions.restart(); break
      case 'quit': this.actions.quit(); break
      case 'settings': this.push('settings'); break
      case 'leaderboard': this.push('leaderboard'); break
      case 'back': this.back(); break
      case 'save-score': this.saveScore(); break
      case 'pause': window.dispatchEvent(new CustomEvent('game:pause')); break
      case 'shop': this.flash(''); this.push('shop'); break
      case 'wardrobe': this.push('wardrobe'); break
      case 'account': this.flash(''); if (this.online.offline) break; this.push('account'); break
      case 'login': this.online.login(); break
      case 'logout': void this.run(() => this.online.logout()); break
      case 'standalone': this.online.openStandalone(); break
      case 'restore': void this.run(() => this.online.refresh(), 'account.restored'); break
      case 'buy': void this.run(() => this.online.checkout(target.dataset.product as ProductId)); break
      case 'spend': {
        if (target.dataset.short) { this.flash('error.not_enough_feathers', 'bad'); break }
        void this.run(() => this.online.spend(target.dataset.item as FeatherItemId), 'shop.spent')
        break
      }
      case 'club-cancel': void this.run(() => this.online.setMembershipCancel(true), 'club.cancelled'); break
      case 'club-resume': void this.run(() => this.online.setMembershipCancel(false), 'club.resumed'); break
      case 'portal': void this.run(() => this.online.billingPortal()); break
      case 'equip': this.equip(Number(target.dataset.bird), target.dataset.skin || null); break
      case 'cycle-mode': this.cycle('mode'); break
      case 'toggle-egg': this.wantsBonusEgg = !this.wantsBonusEgg; this.renderSetup(); break
      case 'cycle-location': this.cycle('location'); break
      case 'board-tab': this.boardTab = target.dataset.tab as BoardTab; this.renderLeaderboard(); break
      case 'board-period': this.boardPeriod = target.dataset.period as 'all' | 'week'; this.renderLeaderboard(); break
    }
  }

  private onInput(e: Event): void {
    const el = e.target as HTMLInputElement
    if (el.type !== 'range') return
    el.style.setProperty('--fill', `${((Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min))) * 100}%`)
    this.actions.settings({ [el.name]: Number(el.value) } as Partial<SaveData>)
  }

  private onKey(e: KeyboardEvent): void {
    if (this.screen === 'hud' || this.screen === 'boot') return
    const typing = (e.target as HTMLElement).matches?.('input[type="text"]')
    if ((e.code === 'Escape' || (e.code === 'Backspace' && !typing)) && this.screen !== 'title') {
      // The pause toggle in main.ts owns Escape on the pause screen itself.
      if (this.screen !== 'pause' && this.screen !== 'results') {
        e.preventDefault()
        // Escape is also the pause toggle; consume it so leaving Settings doesn't resume the run.
        this.input.consume('pause')
        this.back()
      }
      return
    }
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault()
      this.moveFocus(e.code === 'ArrowDown' ? 1 : -1)
    }
  }

  /** Per-frame gamepad menu navigation (keyboard uses native focus + onKey). */
  frame(frameSeconds: number): void {
    if (this.input.method !== this.lastMethod) {
      this.lastMethod = this.input.method
      this.renderPrompts()
      this.renderHint()
    }
    if (this.screen === 'hud' || this.screen === 'boot') return
    if (this.input.method !== 'gamepad') {
      this.input.consume('confirm')
      this.input.consume('back')
      return
    }
    const y = this.input.move.y
    const x = this.input.move.x
    this.navRepeat = Math.max(0, this.navRepeat - frameSeconds)
    const active = document.activeElement as HTMLElement | null
    if (Math.abs(y) > 0.6 && this.navRepeat <= 0) {
      this.moveFocus(y < 0 ? 1 : -1)
      this.navRepeat = 0.22
    } else if (Math.abs(x) > 0.6 && this.navRepeat <= 0 && active?.matches('input[type="range"]')) {
      const r = active as HTMLInputElement
      r.value = String(Number(r.value) + Math.sign(x) * Number(r.step || 0.1))
      r.dispatchEvent(new Event('input', { bubbles: true }))
      this.navRepeat = 0.12
    } else if (Math.abs(x) > 0.6 && this.navRepeat <= 0 && active?.parentElement?.matches('.seg')) {
      const sib = (Math.sign(x) > 0 ? active.nextElementSibling : active.previousElementSibling) as HTMLElement | null
      sib?.focus()
      this.navRepeat = 0.22
    } else if (Math.abs(y) < 0.3 && Math.abs(x) < 0.3) {
      this.navRepeat = 0
    }
    if (this.input.consume('confirm')) active?.click()
    if (this.input.consume('back') && this.screen !== 'title') this.back()
  }

  private navItems(): HTMLElement[] {
    const screen = this.q(`[data-screen="${this.screen}"]`)
    return [...screen.querySelectorAll<HTMLElement>('[data-nav]')].filter(el => el.offsetParent !== null && !el.closest('.is-hidden'))
  }

  private moveFocus(dir: 1 | -1): void {
    const items = this.navItems()
    if (items.length === 0) return
    // Buttons inside one segmented control count as a single row.
    const rows: HTMLElement[][] = []
    for (const el of items) {
      const seg = el.parentElement?.matches('.seg') ? el.parentElement : null
      const last = rows[rows.length - 1]
      if (seg && last && last[0].parentElement === seg) last.push(el)
      else rows.push([el])
    }
    const current = rows.findIndex(r => r.includes(document.activeElement as HTMLElement))
    const next = rows[(current + dir + rows.length) % rows.length]
    ;(next.find(el => el.getAttribute('aria-pressed') === 'true') ?? next[0]).focus()
  }

  // ─── helpers ────────────────────────────────────────────────────────────

  private translate(): void {
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = this.i18n.t(el.dataset.i18n!)
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-i18n-label]')) el.setAttribute('aria-label', this.i18n.t(el.dataset.i18nLabel!))
    for (const el of this.root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) el.placeholder = this.i18n.t(el.dataset.i18nPlaceholder!)
    this.renderPrompts()
    this.renderHint()
    if (this.screen === 'title') this.renderBest()
    if (this.screen === 'leaderboard') this.renderLeaderboard()
    this.hudCache.clear()
    document.title = this.i18n.t('game.title')
  }

  /** Bottom-bar button prompts follow the active input method. */
  renderPrompts(): void {
    const g = this.input.method === 'gamepad' ? GLYPH.gamepad : GLYPH.keyboard
    const html = this.input.method === 'touch' ? '' : `<span>${g.select} ${this.i18n.t('prompt.select')}</span><span>${g.back} ${this.i18n.t('prompt.back')}</span>`
    for (const el of this.qa('.prompts')) el.innerHTML = html
    const carolKey = this.q('.hud-carol kbd-slot')
    if (carolKey) carolKey.innerHTML = this.input.method === 'touch' ? '' : g.call
    for (const el of this.qa('.hud-flock .flock-key')) el.innerHTML = this.input.method === 'keyboard' ? `<kbd>${Number(el.closest<HTMLElement>('.flock-card')!.dataset.bird) + 1}</kbd>` : ''
  }

  /** Update a HUD text slot only when it changed; returns true if it did. */
  private set(slot: string, html: string): boolean {
    if (this.hudCache.get(slot) === html) return false
    this.hudCache.set(slot, html)
    this.q(`[data-slot="${slot}"]`).innerHTML = html
    return true
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.root.querySelector<T>(sel)!
  }

  private qa<T extends HTMLElement = HTMLElement>(sel: string): T[] {
    return [...this.root.querySelectorAll<T>(sel)]
  }

  private template(): string {
    const range = (name: string, label: string, min: number, max: number, step: number) =>
      `<label class="row"><span data-i18n="${label}"></span><input data-nav type="range" name="${name}" min="${min}" max="${max}" step="${step}"></label>`
    const toggle = (setting: string, label: string) =>
      `<div class="row"><span data-i18n="${label}"></span><button data-nav class="toggle" data-setting="${setting}" aria-pressed="false"><i></i><span></span></button></div>`
    const flock = [
      ['pied', '#f3f1ea', '#141418'],
      ['mottled', '#7a7064', '#c2b9aa'],
      ['black', '#141418', '#f3f1ea'],
    ].map(([id, main, accent], i) => `<div class="flock-card" data-bird="${i}"><span class="flock-icon">${magpieHead(main, accent)}</span><div class="flock-info"><b data-i18n="bird.${id}.name"></b><small data-i18n="bird.${id}.trait"></small><div class="flock-bar"><i></i></div></div><span class="flock-key"></span><span class="flock-tired" data-i18n="hud.tired"></span></div>`).join('')
    return /* html */ `
<section class="screen screen-boot is-active" data-screen="boot">
  <img class="boot-icon" src="${bootIcon}" alt="">
  <div class="boot-bar"><i></i></div>
  <div class="boot-label" data-i18n="boot.loading"></div>
</section>

<section class="screen screen-title" data-screen="title">
  <div class="title-vignette"></div>
  <div class="title-best is-hidden"></div>
  <button data-nav class="account-chip" data-action="account"></button>
  <div class="title-block">
    <div class="logo">
      <span class="logo-gem">${ICON.logo}</span>
      <h1 class="logo-text" data-i18n="game.title"></h1>
    </div>
    <p class="tagline" data-i18n="game.tagline"></p>
    <nav class="menu">
      <button data-nav class="btn btn-primary" data-action="play"><span data-i18n="menu.play"></span></button>
      <div class="setup-row">
        <button data-nav class="btn btn-small btn-setup" data-action="cycle-mode"></button>
        <button data-nav class="btn btn-small btn-setup" data-action="cycle-location"></button>
        <button data-nav class="btn btn-small btn-setup is-hidden" data-action="toggle-egg"></button>
      </div>
      <button data-nav class="btn btn-shop" data-action="shop"><span data-i18n="menu.shop"></span></button>
      <div class="menu-sub">
        <button data-nav class="btn btn-small" data-action="wardrobe"><span data-i18n="menu.wardrobe"></span></button>
        <button data-nav class="btn btn-small" data-action="leaderboard"><span data-i18n="menu.leaderboard"></span></button>
        <button data-nav class="btn btn-small" data-action="settings"><span data-i18n="menu.settings"></span></button>
      </div>
    </nav>
  </div>
  <div class="title-flock">${flock}</div>
  <footer class="bottom-bar"><div class="prompts"></div><small data-i18n="credits.fonts"></small></footer>
</section>

<section class="screen screen-hud" data-screen="hud">
  <div class="hurt-vignette"></div>
  <div class="reticle"><i></i></div>
  <div class="popups"></div>
  <div class="hud-top-left">
    <div class="hud-panel hud-cores"><span class="hud-core-icon">${ICON.feather}</span><b data-slot="score"></b></div>
  </div>
  <div class="hud-top-center">
    <div class="hud-clock"><b data-slot="clock"></b></div>
    <div class="hud-compass is-hidden"><span class="hud-compass-arrow">${ICON.arrow}</span><b data-slot="distance"></b></div>
  </div>
  <div class="hud-top-right">
    <div class="hud-eggs" data-i18n-label="hud.eggs"></div>
    <button class="hud-pause" data-action="pause" data-i18n-label="touch.pause">${ICON.pause}</button>
  </div>
  <div class="hud-combo"><b data-slot="combo"></b><span data-i18n="hud.combo"></span><div class="hud-combo-bar"><i></i></div></div>
  <div class="hud-flock">${flock}</div>
  <div class="hud-carol"><span class="hud-carol-ring">${ICON.note}</span><span class="hud-carol-label" data-i18n="hud.carol"></span><kbd-slot></kbd-slot></div>
  <div class="banner"></div>
  <div class="hint"><span></span></div>
  <div class="touch">
    <div class="touch-stick"><i></i></div>
    <button class="touch-btn touch-swoop" data-touch="swoop"><span data-i18n="touch.swoop"></span></button>
    <button class="touch-btn touch-boost" data-touch="boost"><span data-i18n="touch.boost"></span></button>
    <button class="touch-btn touch-call" data-touch="call"><span data-i18n="touch.call"></span></button>
    <button class="touch-btn touch-switch" data-touch="switch"><span data-i18n="touch.switch"></span></button>
  </div>
</section>

<section class="screen screen-pause screen-modal" data-screen="pause">
  <div class="modal">
    <h2 class="modal-title" data-i18n="pause.title"></h2>
    <nav class="menu">
      <button data-nav class="btn btn-primary" data-action="resume"><span data-i18n="menu.continue"></span></button>
      <button data-nav class="btn" data-action="restart"><span data-i18n="menu.restart"></span></button>
      <button data-nav class="btn" data-action="settings"><span data-i18n="menu.settings"></span></button>
      <button data-nav class="btn" data-action="quit"><span data-i18n="menu.quit"></span></button>
    </nav>
    <p class="pause-help" data-i18n="pause.help"></p>
  </div>
  <footer class="bottom-bar"><div class="prompts"></div></footer>
</section>

<section class="screen screen-settings screen-modal" data-screen="settings">
  <div class="modal modal-wide">
    <h2 class="modal-title" data-i18n="settings.title"></h2>
    <div class="settings-grid">
      <fieldset><legend data-i18n="settings.audio"></legend>
        ${range('callsVolume', 'settings.calls', 0, 1, 0.05)}
        ${range('sfxVolume', 'settings.sfx', 0, 1, 0.05)}
        ${range('musicVolume', 'settings.music', 0, 1, 0.05)}
        ${toggle('muted', 'settings.mute')}
      </fieldset>
      <fieldset><legend data-i18n="settings.controls"></legend>
        ${range('sensitivity', 'settings.sensitivity', 0.2, 3, 0.1)}
        ${toggle('invertY', 'settings.invertY')}
      </fieldset>
      <fieldset><legend data-i18n="settings.display"></legend>
        <div class="row"><span data-i18n="settings.quality"></span><div class="seg" data-setting="quality">
          <button data-nav data-value="low" data-i18n="settings.quality.low"></button><button data-nav data-value="medium" data-i18n="settings.quality.medium"></button><button data-nav data-value="high" data-i18n="settings.quality.high"></button>
        </div></div>
        ${toggle('reducedMotion', 'settings.reducedMotion')}
      </fieldset>
    </div>
    <nav class="menu menu-row"><button data-nav class="btn" data-action="back"><span data-i18n="menu.back"></span></button></nav>
  </div>
  <footer class="bottom-bar"><div class="prompts"></div></footer>
</section>

<section class="screen screen-leaderboard screen-modal" data-screen="leaderboard">
  <div class="modal">
    <h2 class="modal-title" data-i18n="leaderboard.title"></h2>
    <div class="seg-tabs board-tabs"><button data-nav data-action="board-tab" data-tab="local" data-i18n="leaderboard.local"></button><button data-nav data-action="board-tab" data-tab="season-v1" data-i18n="leaderboard.classic"></button><button data-nav data-action="board-tab" data-tab="endless-v1" data-i18n="leaderboard.endless"></button></div>
    <div class="seg-tabs board-period is-hidden"><button data-nav data-action="board-period" data-period="all" data-i18n="leaderboard.allTime"></button><button data-nav data-action="board-period" data-period="week" data-i18n="leaderboard.week"></button></div>
    <div class="board-head"><b>#</b><span></span><span data-i18n="leaderboard.time"></span><em data-i18n="leaderboard.score"></em></div>
    <ol class="board"></ol>
    <nav class="menu menu-row"><button data-nav class="btn" data-action="back"><span data-i18n="menu.back"></span></button></nav>
  </div>
  <footer class="bottom-bar"><div class="prompts"></div></footer>
</section>

<section class="screen screen-shop screen-modal" data-screen="shop">
  <div class="modal modal-wide modal-store">
    <h2 class="modal-title" data-i18n="shop.title"></h2>
    <p class="store-message" data-tone=""></p>
    <div class="shop-body store-scroll"></div>
    <nav class="menu menu-row"><button data-nav class="btn" data-action="wardrobe"><span data-i18n="menu.wardrobe"></span></button><button data-nav class="btn" data-action="back"><span data-i18n="menu.back"></span></button></nav>
  </div>
  <footer class="bottom-bar"><div class="prompts"></div></footer>
</section>

<section class="screen screen-wardrobe screen-modal" data-screen="wardrobe">
  <div class="modal modal-wide modal-store">
    <h2 class="modal-title" data-i18n="wardrobe.title"></h2>
    <p class="store-message" data-tone=""></p>
    <div class="wardrobe-body store-scroll"></div>
    <nav class="menu menu-row"><button data-nav class="btn" data-action="shop"><span data-i18n="menu.shop"></span></button><button data-nav class="btn" data-action="back"><span data-i18n="menu.back"></span></button></nav>
  </div>
  <footer class="bottom-bar"><div class="prompts"></div></footer>
</section>

<section class="screen screen-account screen-modal" data-screen="account">
  <div class="modal modal-wide modal-store">
    <h2 class="modal-title" data-i18n="account.title"></h2>
    <div class="account-body store-scroll"></div>
    <nav class="menu menu-row"><button data-nav class="btn" data-action="back"><span data-i18n="menu.back"></span></button></nav>
  </div>
  <footer class="bottom-bar"><div class="prompts"></div></footer>
</section>

<section class="screen screen-results screen-modal" data-screen="results">
  <div class="modal modal-results">
    <div class="results-stars">${`<span class="star">${ICON.star}</span>`.repeat(3)}</div>
    <h2 class="results-title modal-title"></h2>
    <div class="results-best" data-i18n="results.newBest"></div>
    <dl class="results-table">
      <div><dt data-i18n="results.scares"></dt><dd></dd><dd class="r-scares"></dd></div>
      <div><dt data-i18n="results.hits"></dt><dd></dd><dd class="r-hits"></dd></div>
      <div><dt data-i18n="results.people"></dt><dd></dd><dd class="r-people"></dd></div>
      <div><dt data-i18n="results.defended"></dt><dd></dd><dd class="r-defended"></dd></div>
      <div><dt data-i18n="results.combo"></dt><dd></dd><dd class="r-combo"></dd></div>
      <div class="r-bonus"><dt data-i18n="results.eggBonus"></dt><dd class="r-eggs"></dd><dd class="r-egg-bonus"></dd></div>
      <div class="r-total-row"><dt data-i18n="results.total"></dt><dd></dd><dd class="r-total"></dd></div>
    </dl>
    <div class="results-save">
      <input data-nav class="results-name" type="text" maxlength="16" autocomplete="off" spellcheck="false" data-i18n-placeholder="results.name">
      <button data-nav class="btn btn-small" data-action="save-score"><span data-i18n="results.save"></span></button>
      <span class="results-saved" data-i18n="results.saved"></span>
      <span class="results-rank"></span>
    </div>
    <div class="results-online is-hidden"><span></span><button data-nav class="btn btn-small" data-action="login"><span data-i18n="account.login"></span></button></div>
    <nav class="menu menu-row">
      <button data-nav class="btn btn-primary" data-action="restart"><span data-i18n="results.retry"></span></button>
      <button data-nav class="btn" data-action="quit"><span data-i18n="results.title"></span></button>
    </nav>
  </div>
</section>`
  }
}
