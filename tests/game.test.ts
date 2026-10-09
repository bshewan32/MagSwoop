import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { makeSyllable, motifBank } from '../src/engine/audio'
import { Bird, type BirdIntent } from '../src/game/bird'
import { CONFIG } from '../src/game/config'
import { VARIANTS } from '../src/game/magpies'
import { NEST_TREE, PARK, PERCHES, ROUTES, TREES, pathClearance } from '../src/game/park'
import { legIK } from '../src/game/people'

const none = { trunks: [], blobs: [] }
const idle: BirdIntent = { turn: 0, climb: 0, lookX: 0, lookY: 0, boost: false, flap: false, swoop: false }

describe('park layout', () => {
  it('keeps routes inside the park and trees off the paths', () => {
    for (const r of ROUTES) for (const p of r.pts) expect(Math.hypot(p.x, p.z)).toBeLessThan(PARK.gate + 10)
    for (const t of TREES) expect(pathClearance(t.x, t.z)).toBeGreaterThan(1.5)
  })
  it('routes pass through the nest zone so intruders happen', () => {
    const through = ROUTES.filter(r => r.pts.some(p => Math.hypot(p.x - PARK.nest.x, p.z - PARK.nest.z) < CONFIG.run.nestRadius))
    expect(through.length).toBeGreaterThanOrEqual(2)
  })
  it('has a perch per magpie in the nest tree', () => {
    expect(PERCHES.length).toBe(VARIANTS.length)
    for (const p of PERCHES) expect(Math.hypot(p.x - NEST_TREE.x, p.z - NEST_TREE.z)).toBeLessThan(NEST_TREE.crown + 1)
  })
})

describe('magpies', () => {
  it('ships three distinct plumages with different voices and stats', () => {
    expect(VARIANTS.map(v => v.id)).toEqual(['pied', 'mottled', 'black'])
    expect(new Set(VARIANTS.map(v => v.voice.seed)).size).toBe(3)
    expect(new Set(VARIANTS.map(v => v.voice.pitch)).size).toBe(3)
  })
  it('flies forward, climbs with input and drains stamina when boosting', () => {
    const bird = new Bird(VARIANTS[0], PERCHES[0])
    bird.takeOff()
    const start = bird.pos.clone()
    for (let i = 0; i < 120; i += 1) bird.stepControlled(1 / 60, { ...idle, climb: 1 }, none, () => null)
    expect(bird.pos.distanceTo(start)).toBeGreaterThan(8)
    expect(bird.pos.y).toBeGreaterThan(start.y)
    const s = bird.stamina
    for (let i = 0; i < 120; i += 1) bird.stepControlled(1 / 60, { ...idle, boost: true }, none, () => null)
    expect(bird.stamina).toBeLessThan(s)
  })
  it('never goes below the ground or outside the park', () => {
    const bird = new Bird(VARIANTS[1], PERCHES[1])
    bird.takeOff()
    for (let i = 0; i < 1200; i += 1) bird.stepControlled(1 / 60, { ...idle, climb: -1, turn: 0.2 }, none, () => null)
    expect(bird.pos.y).toBeGreaterThanOrEqual(CONFIG.flight.minHeight - 0.01)
    expect(Math.hypot(bird.pos.x, bird.pos.z)).toBeLessThan(CONFIG.flight.territory + 15)
  })
  it('homes in on a swoop target', () => {
    const bird = new Bird(VARIANTS[2], PERCHES[2])
    bird.takeOff()
    for (let i = 0; i < 30; i += 1) bird.stepControlled(1 / 60, idle, none, () => null)
    const aim = bird.pos.clone().add(new THREE.Vector3(-6, -bird.pos.y + 1.6, -10))
    const target = { aim, alive: true }
    bird.stepControlled(1 / 60, { ...idle, swoop: true }, none, () => target)
    expect(bird.mode).toBe('swoop')
    let closest = Infinity
    for (let i = 0; i < 90; i += 1) {
      bird.stepControlled(1 / 60, idle, none, () => target)
      closest = Math.min(closest, bird.pos.distanceTo(aim))
    }
    expect(closest).toBeLessThan(CONFIG.swoop.hitRadius * 1.5)
  })
  it('the autopilot flies a released bird home to its perch', () => {
    const bird = new Bird(VARIANTS[0], PERCHES[0])
    bird.takeOff()
    for (let i = 0; i < 180; i += 1) bird.stepControlled(1 / 60, { ...idle, turn: 0.3 }, none, () => null)
    bird.release()
    for (let i = 0; i < 60 * 30 && bird.mode !== 'perch'; i += 1) bird.stepAI(1 / 60)
    expect(bird.mode).toBe('perch')
  })
})

describe('people', () => {
  it('solves two-bone leg IK so the foot lands on the target', () => {
    const [hip, knee] = legIK(-0.8, 0.1, 0.45, 0.45)
    // Forward kinematics: a limb hanging down -Y rotated about X.
    const y = -0.45 * Math.cos(hip) - 0.45 * Math.cos(hip + knee)
    const z = -0.45 * Math.sin(hip) - 0.45 * Math.sin(hip + knee)
    expect(y).toBeCloseTo(-0.8, 2)
    expect(z).toBeCloseTo(0.1, 2)
  })
})

describe('magpie song synthesis', () => {
  it('builds a stable motif bank per voice that differs between voices', () => {
    const a = motifBank(VARIANTS[0].voice)
    expect(motifBank(VARIANTS[0].voice)).toEqual(a)
    expect(motifBank(VARIANTS[2].voice)).not.toEqual(a)
    expect(a.length).toBe(4)
    for (const motif of a) expect(motif.length).toBeGreaterThanOrEqual(3)
  })
  it('keeps syllables in a magpie-like range', () => {
    let seed = 1
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 500; i += 1) {
      const s = makeSyllable(r)
      expect(s.f0).toBeGreaterThan(300)
      expect(s.f0).toBeLessThan(3200)
      expect(s.dur).toBeGreaterThan(0.02)
      expect(s.dur).toBeLessThan(0.35)
    }
  })
})
