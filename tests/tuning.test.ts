import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CONFIG, DEFAULT_CONFIG } from '../src/game/config'
import { tuning } from '../src/game/tuning'
import { Bird, type BirdIntent } from '../src/game/bird'
import { ChaseCamera } from '../src/game/camera'
import { VARIANTS } from '../src/game/magpies'
import { PERCHES } from '../src/game/park'
import { createRun } from '../src/game/rules'

const defaults = Object.fromEntries(tuning.controls.map(control => [control.id, control.default]))
const none = { trunks: [], blobs: [] }
const intent: BirdIntent = { turn: 0, climb: 0, lookX: 0, lookY: 0, boost: false, flap: false, swoop: false }
afterEach(() => {
  tuning.apply(defaults)
  for (const boundary of ['swoop', 'run'] as const) tuning.activate(boundary)
})

describe('Three.js tuning', () => {
  it('validates the entire patch before committing and preserves source defaults', () => {
    const before = tuning.read()
    for (const patch of [{ 'flight.cruiseSpeed': 8, 'camera.fov': 999 }, { 'flight.cruiseSpeed': 25 },
      { 'flight.cruiseSpeed': 8.1 }, { 'flight.cruiseSpeed': '8' }, { 'camera.fov': Infinity }, { unknown: 4 }]) {
      expect(() => tuning.apply(patch)).toThrow()
      expect(tuning.read()).toEqual(before)
    }
    tuning.apply({ 'flight.cruiseSpeed': 14, 'flight.boostSpeed': 20 })
    expect(CONFIG.flight.cruiseSpeed).toBe(14)
    expect(DEFAULT_CONFIG.flight.cruiseSpeed).not.toBe(14)
  })
  it('keeps next-swoop and next-run values pending until their own boundary', () => {
    tuning.apply({ 'swoop.speed': 30, 'run.eggs': 5 })
    expect(CONFIG.swoop.speed).toBe(DEFAULT_CONFIG.swoop.speed)
    expect(createRun().eggs).toBe(DEFAULT_CONFIG.run.eggs)
    tuning.activate('swoop')
    expect(CONFIG.swoop.speed).toBe(30)
    expect(tuning.read().requested['run.eggs']).toBe(5)
    tuning.activate('run')
    expect(createRun().eggs).toBe(5)
  })
  it('changes real flight speed live', () => {
    const bird = new Bird(VARIANTS[0], PERCHES[0])
    bird.takeOff()
    for (let i = 0; i < 240; i += 1) bird.stepControlled(1 / 60, intent, none, () => null)
    const slow = bird.speed
    tuning.apply({ 'flight.cruiseSpeed': 16, 'flight.boostSpeed': 22 })
    for (let i = 0; i < 240; i += 1) bird.stepControlled(1 / 60, intent, none, () => null)
    expect(bird.speed).toBeGreaterThan(slow + 2)
  })
  it('updates the actual camera projection without replacing the camera', () => {
    const cam = new ChaseCamera()
    const before = cam.camera
    tuning.apply({ 'camera.fov': 90 })
    const t = { position: new THREE.Vector3(0, 6, 0), yaw: 0, pitch: 0, speed: 0, swooping: false }
    for (let i = 0; i < 120; i += 1) cam.follow(t, 1 / 30, true)
    expect(cam.camera).toBe(before)
    expect(cam.camera.fov).toBeGreaterThan(85)
  })
})

describe('ranked eligibility', () => {
  it('ignores cosmetics and unapplied next-run values, latches live gameplay until a clean new run', () => {
    tuning.activate('run')
    tuning.apply({ 'camera.fov': 90, 'run.eggs': 5 })
    expect(tuning.unranked).toBe(false)
    tuning.apply({ 'flight.cruiseSpeed': 12 })
    expect(tuning.unranked).toBe(true)
    tuning.apply(defaults)
    expect(tuning.unranked).toBe(true)
    tuning.activate('run')
    expect(tuning.unranked).toBe(false)
  })
  it('marks next-action gameplay only when activated', () => {
    tuning.activate('run')
    tuning.apply({ 'swoop.speed': 30 })
    expect(tuning.unranked).toBe(false)
    tuning.activate('swoop')
    expect(tuning.unranked).toBe(true)
    tuning.apply(defaults)
    tuning.activate('swoop')
    tuning.activate('run')
    expect(tuning.unranked).toBe(false)
  })
})
