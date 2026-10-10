import { afterEach, describe, expect, it } from 'vitest'
import { CONFIG } from '../src/game/config'
import { basePoints, createRun, formatClock, loseEgg, pressure, scorePerson, stars, tick } from '../src/game/rules'
import { LOCATIONS, PARK, ROUTES, TREES, WHEELED, pathClearance, setLocation } from '../src/game/park'
import { SKINS, skinById } from '../src/game/magpies'
import { defaultSave, mergeSave, parseSave } from '../src/engine/save'

afterEach(() => setLocation('park'))

describe('endless mode', () => {
  it('has no clock and only ends when the last egg goes', () => {
    let s = createRun('endless')
    expect(s.timeLeft).toBe(Infinity)
    expect(formatClock(s.timeLeft)).toBe('∞')
    for (let i = 0; i < 600; i += 1) s = tick(s, 1)
    expect(s.phase).toBe('playing')
    for (let i = 0; i < CONFIG.run.eggs; i += 1) s = loseEgg(s)
    expect(s.phase).toBe('lost')
  })

  it('ramps crowd pressure past the classic season level, up to a cap', () => {
    const s = createRun('endless')
    expect(pressure({ ...s, elapsed: 0 })).toBe(0)
    expect(pressure({ ...s, elapsed: CONFIG.endless.rampSeconds })).toBeCloseTo(1)
    expect(pressure({ ...s, elapsed: 1e6 })).toBe(CONFIG.endless.maxPressure)
    expect(pressure({ ...createRun('classic'), elapsed: 1e6 })).toBe(1)
  })

  it('restocks a lost egg when the score crosses a restock threshold', () => {
    let s = loseEgg(createRun('endless'))
    s = { ...s, score: CONFIG.endless.restockEvery - 10 }
    const r = scorePerson(s, 'cyclist', 'hit', false)
    expect(r.state.eggs).toBe(CONFIG.run.eggs)
    expect(r.state.restocked).toBe(1)
    // A full nest is never over-filled, and classic never restocks.
    const full = scorePerson({ ...createRun('endless'), score: CONFIG.endless.restockEvery - 10 }, 'cyclist', 'hit', false)
    expect(full.state.eggs).toBe(CONFIG.run.eggs)
    const classic = scorePerson({ ...loseEgg(createRun('classic')), score: CONFIG.endless.restockEvery - 10 }, 'cyclist', 'hit', false)
    expect(classic.state.eggs).toBe(CONFIG.run.eggs - 1)
  })

  it('rates endless runs by score alone', () => {
    const s = { ...createRun('endless'), phase: 'lost' as const }
    expect(stars({ ...s, score: 0 })).toBe(0)
    expect(stars({ ...s, score: CONFIG.score.starScore * 3 })).toBe(3)
  })

  it('a bonus egg adds one to the starting clutch', () => {
    expect(createRun('classic', 1).eggs).toBe(CONFIG.run.eggs + 1)
  })
})

describe('new intruders', () => {
  it('scores surfers and e-scooter riders and counts them separately', () => {
    expect(basePoints('surfer', 'scare')).toBe(CONFIG.score.scareSurfer)
    expect(basePoints('scooter', 'hit')).toBe(CONFIG.score.hitScooter)
    expect(basePoints('scooter', 'hit')).toBeGreaterThan(basePoints('surfer', 'hit'))
    let s = createRun()
    s = scorePerson(s, 'surfer', 'scare', false).state
    s = scorePerson(s, 'scooter', 'scare', false).state
    expect([s.surfers, s.scooters, s.runners, s.cyclists]).toEqual([1, 1, 0, 0])
    expect(WHEELED).toContain('scooter')
  })
})

describe('beach esplanade', () => {
  it('swaps the live layout and back', () => {
    const parkRoutes = ROUTES.map(r => r.def.id)
    setLocation('beach')
    expect(ROUTES.map(r => r.def.id)).toEqual(LOCATIONS.beach.routes.map(r => r.id))
    expect(ROUTES.some(r => r.def.kinds.includes('surfer'))).toBe(true)
    expect(ROUTES.some(r => r.def.kinds.includes('scooter'))).toBe(true)
    setLocation('park')
    expect(ROUTES.map(r => r.def.id)).toEqual(parkRoutes)
  })

  it('keeps trees off the sand and clear of every path', () => {
    setLocation('beach')
    expect(TREES.length).toBeGreaterThan(8)
    for (const t of TREES) {
      expect(t.x).toBeLessThan(LOCATIONS.beach.sandX!)
      expect(pathClearance(t.x, t.z)).toBeGreaterThan(3)
    }
  })

  it('routes start and end outside the gate so people walk in and out', () => {
    setLocation('beach')
    for (const r of ROUTES) {
      const a = r.def.points[0]
      const b = r.def.points[r.def.points.length - 1]
      expect(Math.hypot(a.x, a.z)).toBeGreaterThan(PARK.gate - 2)
      expect(Math.hypot(b.x, b.z)).toBeGreaterThan(PARK.gate - 2)
    }
  })

  it('some route brings intruders through the nest zone', () => {
    setLocation('beach')
    const near = ROUTES.some(r => r.pts.some(p => Math.hypot(p.x - PARK.nest.x, p.z - PARK.nest.z) < CONFIG.run.nestRadius))
    expect(near).toBe(true)
  })
})

describe('skins', () => {
  it('have unique ids and resolve by id', () => {
    const ids = SKINS.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(skinById(id)?.id).toBe(id)
    expect(skinById(null)).toBeNull()
    expect(skinById('skin_nope')).toBeNull()
  })
})

describe('save: skins, setup and cloud merge', () => {
  it('parses equipped skins, location and mode defensively', () => {
    const s = parseSave(JSON.stringify({ version: 1, skins: ['skin_golden', '<script>', 7], location: 'beach', mode: 'endless' }))
    expect(s.skins).toEqual(['skin_golden', null, null])
    expect(s.location).toBe('beach')
    expect(s.mode).toBe('endless')
    const bad = parseSave(JSON.stringify({ version: 1, location: 'moon', mode: 'hard' }))
    expect([bad.location, bad.mode]).toEqual(['park', 'classic'])
  })

  it('merges a cloud save: cloud settings win, scores union, tutorial stays done, quality stays local', () => {
    const local = { ...defaultSave(), quality: 'low' as const, tutorialDone: true, sfxVolume: 0.2, leaderboard: [{ name: 'LOCAL', score: 900, seconds: 150, at: 1 }] }
    const cloud = { sfxVolume: 0.7, tutorialDone: false, quality: 'high', skins: ['skin_night', null, null], leaderboard: [{ name: 'CLOUD', score: 1200, seconds: 150, at: 2 }] }
    const m = mergeSave(local, cloud)
    expect(m.sfxVolume).toBe(0.7)
    expect(m.quality).toBe('low')
    expect(m.tutorialDone).toBe(true)
    expect(m.skins[0]).toBe('skin_night')
    expect(m.leaderboard.map(e => e.name)).toEqual(['CLOUD', 'LOCAL'])
    // Merging twice does not duplicate scores.
    expect(mergeSave(m, cloud).leaderboard).toHaveLength(2)
    // Garbage from the cloud never breaks the local save.
    expect(mergeSave(local, 'nonsense').sfxVolume).toBe(defaultSave().sfxVolume)
  })
})
