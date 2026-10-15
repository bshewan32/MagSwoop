/**
 * Home-screen ("install as an app") support.
 *
 * - Registers the offline service worker (production builds only, never inside the Manus preview
 *   iframe or the dev server).
 * - Tracks whether the game can be installed: Chrome/Edge/Android expose a native prompt via
 *   `beforeinstallprompt`; iPhone/iPad need manual "Share → Add to Home Screen" steps.
 * - Applies a downloaded update only while the player is not mid-run, so a new version never
 *   reloads the page under them.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type InstallKind = 'native' | 'ios' | 'none'

type Listener = () => void

function embedded(): boolean {
  try {
    return window.top !== window.self
  } catch {
    return true
  }
}

export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.matchMedia?.('(display-mode: fullscreen)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function isIos(): boolean {
  const ua = navigator.userAgent
  // iPadOS reports itself as a Mac; touch support gives it away.
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

class HomeScreen {
  private deferred: InstallPromptEvent | null = null
  private listeners = new Set<Listener>()
  private updateReady = false
  private canReload: () => boolean = () => true
  readonly standalone = isStandalone()

  /** How the game can be installed right now, if at all. */
  get kind(): InstallKind {
    if (this.standalone || embedded()) return 'none'
    if (this.deferred) return 'native'
    if (isIos()) return 'ios'
    return 'none'
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  /** Show the browser's own install dialog (Chrome/Edge/Android). Must run from a tap/click. */
  async promptInstall(): Promise<boolean> {
    const e = this.deferred
    if (!e) return false
    this.deferred = null
    await e.prompt()
    const { outcome } = await e.userChoice.catch(() => ({ outcome: 'dismissed' as const }))
    this.emit()
    return outcome === 'accepted'
  }

  /**
   * Start listening for install availability and register the service worker.
   * `canReload` should return true only when reloading would not interrupt play (title screen).
   */
  init(canReload: () => boolean): void {
    this.canReload = canReload
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault()
      this.deferred = e as InstallPromptEvent
      this.emit()
    })
    window.addEventListener('appinstalled', () => {
      this.deferred = null
      this.emit()
    })
    this.tryAudioSession()
    if (!import.meta.env.PROD || embedded() || !('serviceWorker' in navigator)) return
    // The game may finish booting after the page's load event; register right away in that case.
    if (document.readyState === 'complete') void this.register()
    else window.addEventListener('load', () => void this.register(), { once: true })
  }

  /** Call when the player is back on a safe screen; applies a waiting update if there is one. */
  safePoint(): void {
    if (this.updateReady && this.canReload()) location.reload()
  }

  private async register(): Promise<void> {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' })
      const hadController = !!navigator.serviceWorker.controller
      const activate = (w: ServiceWorker | null) => w?.postMessage('skip-waiting')
      // A newer version downloaded on a previous visit: switch to it now, before play starts.
      if (reg.waiting && hadController) activate(reg.waiting)
      reg.addEventListener('updatefound', () => {
        const w = reg.installing
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) activate(w)
        })
      })
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) return // first install: nothing to refresh
        this.updateReady = true
        this.safePoint()
      })
      // Installed apps can stay open for days; check for a new version when brought back.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update().catch(() => {})
      })
    } catch {
      // Offline support is a bonus; the game works without it.
    }
  }

  /**
   * iOS mutes Web Audio when the ringer switch is on silent. A game whose magpie songs are the
   * point should play like other games do, so ask for the playback session where supported.
   */
  private tryAudioSession(): void {
    const s = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
    if (s && isIos()) {
      try { s.type = 'playback' } catch { /* unsupported */ }
    }
  }
}

export const homeScreen = new HomeScreen()
