import { CONFIG } from './config'
import type { PersonKind } from './park'

/**
 * Pure run rules: score, combo, carol buff, eggs, clock, win/lose. No three.js, no DOM — the
 * scene reports events and reads the resulting state, and unit tests cover every rule here.
 */
export type RunPhase = 'playing' | 'won' | 'lost'
export type Outcome = 'scare' | 'hit'
export type RunMode = 'classic' | 'endless'

export type RunState = {
  /** Classic: survive a 2:30 season. Endless (Season+): until the last egg is lost. */
  mode: RunMode
  /** Gameplay tuning was changed during this run. */
  unranked: boolean
  phase: RunPhase
  score: number
  eggs: number
  timeLeft: number
  elapsed: number
  combo: number
  comboTimer: number
  bestCombo: number
  scares: number
  hits: number
  runners: number
  cyclists: number
  surfers: number
  scooters: number
  defended: number
  /** Eggs restocked in Endless mode. */
  restocked: number
  /** Seconds left on the territorial carol buff, and until the next carol is allowed. */
  carolTime: number
  carolCooldown: number
  /** End-of-season bonus for eggs kept (already included in `score`). */
  eggBonus: number
}

export function createRun(mode: RunMode = 'classic', bonusEggs = 0): RunState {
  return {
    mode, unranked: false, phase: 'playing', score: 0, eggs: CONFIG.run.eggs + bonusEggs, timeLeft: mode === 'endless' ? Infinity : CONFIG.run.seconds, elapsed: 0,
    combo: 0, comboTimer: 0, bestCombo: 0, scares: 0, hits: 0, runners: 0, cyclists: 0, surfers: 0, scooters: 0, defended: 0, restocked: 0,
    carolTime: 0, carolCooldown: 0, eggBonus: 0,
  }
}

/** Crowd pressure 0..: classic ramps 0→1 over the season, endless keeps climbing. */
export function pressure(s: RunState): number {
  if (s.mode === 'endless') return Math.min(CONFIG.endless.maxPressure, s.elapsed / CONFIG.endless.rampSeconds)
  return Math.min(1, s.elapsed / CONFIG.run.seconds)
}

/** Advance timers. Surviving to the end of the clock with eggs left wins the season. */
export function tick(s: RunState, dt: number): RunState {
  if (s.phase !== 'playing') return s
  const timeLeft = s.mode === 'endless' ? Infinity : Math.max(0, s.timeLeft - dt)
  const comboTimer = Math.max(0, s.comboTimer - dt)
  const next: RunState = {
    ...s,
    timeLeft,
    elapsed: s.elapsed + dt,
    comboTimer,
    combo: comboTimer > 0 ? s.combo : 0,
    carolTime: Math.max(0, s.carolTime - dt),
    carolCooldown: Math.max(0, s.carolCooldown - dt),
  }
  if (timeLeft <= 0) {
    const eggBonus = next.eggs * CONFIG.score.eggBonus
    return { ...next, phase: 'won', eggBonus, score: next.score + eggBonus }
  }
  return next
}

export function basePoints(kind: PersonKind, outcome: Outcome): number {
  const sc = CONFIG.score
  const table: Record<PersonKind, [number, number]> = {
    runner: [sc.scareRunner, sc.hitRunner],
    cyclist: [sc.scareCyclist, sc.hitCyclist],
    surfer: [sc.scareSurfer, sc.hitSurfer],
    scooter: [sc.scareScooter, sc.hitScooter],
  }
  return table[kind][outcome === 'hit' ? 1 : 0]
}

/** A person was driven off by a scare or a direct hit. Returns the points it was worth. */
export function scorePerson(s: RunState, kind: PersonKind, outcome: Outcome, inNest = false): { state: RunState; points: number } {
  if (s.phase !== 'playing') return { state: s, points: 0 }
  const combo = Math.min(CONFIG.score.comboMax, s.comboTimer > 0 ? s.combo + 1 : 1)
  const carolBoost = s.carolTime > 0 ? CONFIG.score.carolMultiplier : 1
  const points = Math.round(basePoints(kind, outcome) * combo * carolBoost) + (inNest ? CONFIG.score.defendBonus : 0)
  const score = s.score + points
  // Endless: the parents restock a lost egg each time the score passes a multiple of restockEvery.
  const every = CONFIG.endless.restockEvery
  const restock = s.mode === 'endless' && Math.floor(score / every) > Math.floor(s.score / every) && s.eggs < CONFIG.run.eggs ? 1 : 0
  return {
    points,
    state: {
      ...s,
      score,
      eggs: s.eggs + restock,
      restocked: s.restocked + restock,
      combo,
      comboTimer: CONFIG.score.comboWindow,
      bestCombo: Math.max(s.bestCombo, combo),
      scares: s.scares + (outcome === 'scare' ? 1 : 0),
      hits: s.hits + (outcome === 'hit' ? 1 : 0),
      runners: s.runners + (kind === 'runner' ? 1 : 0),
      cyclists: s.cyclists + (kind === 'cyclist' ? 1 : 0),
      surfers: s.surfers + (kind === 'surfer' ? 1 : 0),
      scooters: s.scooters + (kind === 'scooter' ? 1 : 0),
      defended: s.defended + (inNest ? 1 : 0),
    },
  }
}

/** An intruder got past the nest unchallenged: lose an egg and the combo. */
export function loseEgg(s: RunState): RunState {
  if (s.phase !== 'playing' || s.eggs <= 0) return s
  const eggs = s.eggs - 1
  return { ...s, eggs, combo: 0, comboTimer: 0, phase: eggs <= 0 ? 'lost' : 'playing' }
}

/** Start the territorial carol if it is off cooldown. */
export function carol(s: RunState): { state: RunState; ok: boolean } {
  if (s.phase !== 'playing' || s.carolCooldown > 0) return { state: s, ok: false }
  return { ok: true, state: { ...s, carolTime: CONFIG.carol.buffTime, carolCooldown: CONFIG.carol.cooldown } }
}

/** 1 star for surviving the season, +1 for keeping every egg, +1 for a big score. */
export function stars(s: RunState): number {
  if (s.mode === 'endless') return s.score >= CONFIG.score.starScore * 3 ? 3 : s.score >= CONFIG.score.starScore * 1.5 ? 2 : s.score >= CONFIG.score.starScore * 0.5 ? 1 : 0
  if (s.phase !== 'won') return 0
  return 1 + (s.eggs >= CONFIG.run.eggs ? 1 : 0) + (s.score >= CONFIG.score.starScore ? 1 : 0)
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds)) return '∞'
  const whole = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
