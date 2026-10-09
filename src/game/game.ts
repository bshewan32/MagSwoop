import * as THREE from 'three'
import type { Audio, Spatial } from '../engine/audio'
import type { Input } from '../engine/input'
import type { Renderer } from '../engine/renderer'
import type { Quality } from '../engine/save'
import { Bird, angleDelta, type BirdEvent, type BirdMode, type SwoopTarget } from './bird'
import { ChaseCamera } from './camera'
import { CONFIG } from './config'
import { Effects } from './fx'
import { VARIANTS, type Variant } from './magpies'
import { PARK, PERCHES } from './park'
import { Crowd, type Person } from './people'
import { carol, createRun, loseEgg, scorePerson, tick, type Outcome, type RunState } from './rules'
import { tuning } from './tuning'
import { World } from './world'

export type GameMode = 'title' | 'playing' | 'paused' | 'ended'
export type Hint = 'fly' | 'swoop' | 'call' | 'switch' | 'nest'
export type PopupKind = 'score' | 'hit' | 'shout' | 'carol' | 'bad'
export type Point = { x: number; y: number }

export type GameHooks = {
  t(key: string, vars?: Record<string, string | number>): string
  popup(text: string, at: Point, kind: PopupKind): void
  banner(key: string, tone?: 'good' | 'bad'): void
  eggLost(): void
  hint(hint: Hint | null): void
  tutorialDone(): void
  end(run: RunState): void
}

export type BirdStatus = { variant: Variant; stamina: number; tired: boolean; active: boolean; mode: BirdMode }
export type HudStatus = {
  flock: BirdStatus[]
  /** Nearest intruder in the nest zone, relative to the bird's heading. */
  intruder: { angle: number; distance: number } | null
  /** Screen position of the current swoop target (or candidate). */
  lock: (Point & { locked: boolean }) | null
  carolActive: boolean
  carolReady: number
}

const SHOUTS = 12
const TUTORIAL: Hint[] = ['fly', 'swoop', 'call', 'switch', 'nest']

export class Game {
  mode: GameMode = 'title'
  run: RunState = createRun()
  reducedMotion = false
  readonly world: World
  readonly cam = new ChaseCamera()
  readonly fx = new Effects()
  readonly flock: Bird[]
  readonly crowd: Crowd
  active = 0
  private time = 0
  private seed = 1
  private switchCooldown = 0
  private tutorial = -1
  private tutorialTimer = 0
  private tiredHintShown = false
  private alertCooldown = 0
  private edgeCooldown = 0
  private chortleCooldown = 0
  private chatterTimer = 5
  private candidate: Person | null = null
  private readonly v = new THREE.Vector3()
  private readonly right = new THREE.Vector3()

  constructor(private readonly renderer: Renderer, private readonly input: Input, private readonly audio: Audio, private readonly hooks: GameHooks, quality: Quality) {
    this.world = new World(renderer.shadowMapSize, quality === 'low')
    this.flock = VARIANTS.map((variant, i) => new Bird(variant, PERCHES[i]))
    for (const b of this.flock) this.world.scene.add(b.model.root)
    this.crowd = new Crowd(this.world.scene)
    this.crowd.reset(0)
    this.world.scene.add(this.fx.mesh)
  }

  get bird(): Bird {
    return this.flock[this.active]
  }

  start(tutorial: boolean): void {
    tuning.activate('run')
    this.run = { ...createRun(), unranked: tuning.unranked }
    for (const b of this.flock) {
      b.land()
      b.stamina = 1
      b.tired = false
    }
    this.active = 0
    this.bird.takeOff()
    this.crowd.reset(this.seed++)
    this.world.setEggs(this.run.eggs)
    this.fx.clear()
    this.cam.reset(this.chaseTarget())
    this.mode = 'playing'
    this.tiredHintShown = false
    this.tutorial = tutorial ? 0 : -1
    this.tutorialTimer = 0
    this.hooks.hint(tutorial ? TUTORIAL[0] : null)
    this.input.endFrame()
    this.input.takeLook()
    this.audio.song(this.bird.variant.voice, 'carol', { gain: 0.9 })
  }

  pause(): void {
    if (this.mode === 'playing') this.mode = 'paused'
  }

  resume(): void {
    if (this.mode !== 'paused') return
    this.mode = 'playing'
    this.input.endFrame()
    this.input.takeLook()
  }

  toTitle(): void {
    this.mode = 'title'
    for (const b of this.flock) b.land()
    this.active = 0
    this.crowd.reset(0)
    this.world.setEggs(CONFIG.run.eggs)
    this.world.setNestAlert(0)
    this.hooks.hint(null)
  }

  setQuality(quality: Quality): void {
    this.renderer.applyQuality(quality)
    const size = this.renderer.shadowMapSize
    this.world.sun.shadow.mapSize.set(size, size)
    this.world.sun.shadow.map?.dispose()
    this.world.sun.shadow.map = null
  }

  /** Switch control to another magpie; the old one flies home to rest. */
  switchTo(index: number): boolean {
    if (this.mode !== 'playing' || index === this.active || this.switchCooldown > 0) return false
    const old = this.bird
    old.release()
    this.active = index
    const next = this.bird
    next.takeOff()
    this.switchCooldown = 0.35
    this.audio.play('switch')
    this.audio.song(next.variant.voice, 'chirp', this.spatial(next.pos))
    this.hooks.banner(next.variant.nameKey, 'good')
    this.advanceTutorial('switch')
    return true
  }

  step(dt: number): void {
    if (this.mode === 'paused') return
    const progress = this.mode === 'playing' ? this.run.elapsed / CONFIG.run.seconds : 0.25
    if (this.mode !== 'playing') {
      for (const b of this.flock) b.stepAI(dt)
      this.crowd.step(dt, progress)
      if (this.mode === 'title') this.input.takeLook()
      this.ambientChatter(dt)
      return
    }
    const input = this.input
    const look = input.takeLook()
    const swoop = input.consume('swoop')
    if (swoop) tuning.activate('swoop')
    let pick = -1
    if (input.consume('switch')) pick = (this.active + 1) % this.flock.length
    if (input.consume('bird1')) pick = 0
    if (input.consume('bird2')) pick = 1
    if (input.consume('bird3')) pick = 2
    if (pick >= 0) this.switchTo(pick)
    if (input.consume('call')) this.carol()

    const bird = this.bird
    const events = bird.stepControlled(dt, {
      turn: input.move.x, climb: input.move.y, lookX: look.x, lookY: look.y,
      boost: input.held('boost'), flap: input.consume('flap'), swoop,
    }, this.world.obstacles, b => this.pickTarget(b))
    for (const e of events) this.onBirdEvent(e)
    for (const b of this.flock) if (b !== bird) b.stepAI(dt)

    this.crowd.step(dt, progress)
    this.interact()
    this.guardNest()
    this.run = tick(this.run, dt)
    this.switchCooldown = Math.max(0, this.switchCooldown - dt)
    this.alertCooldown = Math.max(0, this.alertCooldown - dt)
    this.edgeCooldown = Math.max(0, this.edgeCooldown - dt)
    this.chortleCooldown = Math.max(0, this.chortleCooldown - dt)
    this.ambientChatter(dt)
    this.updateTutorial(dt)
    if (this.run.phase !== 'playing') this.finish()
  }

  private carol(): void {
    const r = carol(this.run)
    if (!r.ok) return
    this.run = r.state
    const bird = this.bird
    this.audio.song(bird.variant.voice, 'carol', { gain: 1 })
    // The family joins in from the tree.
    this.flock.forEach((b, i) => {
      if (b !== bird) window.setTimeout(() => this.audio.song(b.variant.voice, 'carol', { ...this.spatial(b.pos), gain: 0.55 }), 350 + i * 260)
    })
    this.hooks.popup(this.hooks.t('pop.carol'), this.screen(bird.pos, { x: 0.5, y: 0.4 }), 'carol')
    this.advanceTutorial('call')
  }

  private onBirdEvent(e: BirdEvent): void {
    const bird = this.bird
    switch (e.type) {
      case 'flap': this.audio.play('flap', { gain: 0.8 }); break
      case 'swoop':
        this.audio.play('whoosh')
        this.audio.song(bird.variant.voice, 'alarm', { gain: 0.9 })
        this.advanceTutorial('swoop')
        break
      case 'rustle':
        this.audio.play('rustle', { gain: 0.7 })
        this.fx.burst(e.at, '#6f8a4a', 10, 3)
        break
      case 'tired':
        this.audio.play('tired')
        this.hooks.banner('banner.tired', 'bad')
        if (!this.tiredHintShown && this.tutorial < 0) {
          this.tiredHintShown = true
          this.hooks.hint('switch')
          window.setTimeout(() => this.tutorial < 0 && this.hooks.hint(null), 4500)
        }
        break
      case 'edge':
        if (this.edgeCooldown <= 0) {
          this.edgeCooldown = 4
          this.hooks.banner('banner.edge')
        }
        break
    }
  }

  /** Best swoop target in front of the bird: close, centred, and intruders first. */
  pickTarget(bird: Bird): Person | null {
    const S = CONFIG.swoop
    const fx = -Math.sin(bird.yaw)
    const fz = -Math.cos(bird.yaw)
    const cosLimit = Math.cos(S.lockAngle)
    let best: Person | null = null
    let bestScore = Infinity
    for (const p of this.crowd.people) {
      if (!p.alive) continue
      const dx = p.aim.x - bird.pos.x
      const dz = p.aim.z - bird.pos.z
      const flat = Math.hypot(dx, dz)
      const dist = Math.hypot(flat, p.aim.y - bird.pos.y)
      if (dist > S.lockRange || flat < 0.5) continue
      const cos = (dx * fx + dz * fz) / flat
      if (cos < cosLimit) continue
      const score = dist * (1 + (1 - cos) * 4) * (p.intruder ? 0.6 : 1)
      if (score < bestScore) {
        bestScore = score
        best = p
      }
    }
    return best
  }

  private interact(): void {
    const bird = this.bird
    const v = bird.variant
    const S = CONFIG.swoop
    const hitR = S.hitRadius * v.hit
    const scareR = S.scareRadius * v.scare * (this.run.carolTime > 0 ? CONFIG.carol.scareBoost : 1)
    const fast = bird.mode === 'swoop' || bird.speed > CONFIG.flight.cruiseSpeed * 1.2
    for (const p of this.crowd.people) {
      if (!p.alive) continue
      const d = bird.pos.distanceTo(p.aim)
      if (d < hitR && fast) this.resolve(p, 'hit')
      else if (d < scareR) {
        if (!p.threat) {
          p.threat = true
          this.audio.play('yelp', { ...this.spatial(p.aim), pitch: p.kind === 'cyclist' ? 0.9 : 1.15 + (p.id % 3) * 0.1 })
          if (p.kind === 'cyclist') this.audio.play('bell', this.spatial(p.aim))
        }
      } else if (p.threat) this.resolve(p, 'scare')
    }
  }

  private resolve(p: Person, outcome: Outcome): void {
    const bird = this.bird
    const inNest = p.inNest
    const r = scorePerson(this.run, p.kind, outcome, inNest)
    this.run = r.state
    p.flee(bird.pos, outcome === 'hit')
    const at = this.screen(p.aim, { x: 0.5, y: 0.35 })
    this.hooks.popup(`+${r.points}`, at, outcome === 'hit' ? 'hit' : 'score')
    this.hooks.popup(this.hooks.t(`shout.${(p.id * 7 + this.run.scares) % SHOUTS}`), { x: at.x, y: at.y - 46 }, 'shout')
    if (inNest) this.hooks.banner('banner.defended', 'good')
    if (outcome === 'hit') {
      this.audio.play('hit', this.spatial(p.aim))
      this.audio.play('yelp', { ...this.spatial(p.aim), pitch: 1.3 })
      this.fx.burst(p.aim, bird.variant.swatch[0], 14, 5)
      this.fx.burst(p.aim, bird.variant.swatch[1], 10, 4)
      this.fx.burst(p.aim, '#ffd35c', 8, 3)
      this.cam.addShake(0.45)
    } else {
      this.fx.puff(new THREE.Vector3(p.pos.x, 0.1, p.pos.z), 0.6)
      this.cam.addShake(0.12)
    }
    if (this.chortleCooldown <= 0) {
      this.chortleCooldown = 1.4
      window.setTimeout(() => this.audio.song(bird.variant.voice, 'chortle', { gain: 0.8 }), 250)
    }
    if (bird.mode === 'swoop' && bird.target === (p as SwoopTarget)) bird.pullUp()
  }

  private guardNest(): void {
    const R = CONFIG.run.nestRadius
    let alert = false
    for (const p of this.crowd.people) {
      if (!p.alive) continue
      const inside = Math.hypot(p.pos.x - PARK.nest.x, p.pos.z - PARK.nest.z) < R
      if (inside && !p.inNest) {
        p.inNest = true
        p.intruder = true
        if (this.alertCooldown <= 0) {
          this.alertCooldown = 3
          this.audio.play('alert')
          this.hooks.banner('banner.intruder', 'bad')
          // The resting birds sound the alarm from the tree.
          for (const b of this.flock) if (b !== this.bird && b.mode === 'perch') this.audio.song(b.variant.voice, 'alarm', { ...this.spatial(b.pos), gain: 0.5 })
        }
      } else if (!inside && p.inNest) {
        p.inNest = false
        if (p.intruder) {
          p.intruder = false
          this.run = loseEgg(this.run)
          this.world.setEggs(this.run.eggs)
          this.audio.play('egg')
          this.hooks.eggLost()
          this.hooks.banner('banner.eggLost', 'bad')
        }
      }
      if (p.intruder) alert = true
    }
    this.world.setNestAlert(alert ? 1 : 0)
  }

  private ambientChatter(dt: number): void {
    this.chatterTimer -= dt
    if (this.chatterTimer > 0) return
    this.chatterTimer = 5 + Math.random() * 6
    const resting = this.flock.filter(b => b.mode === 'perch' && (this.mode !== 'playing' || b !== this.bird))
    const b = resting[Math.floor(Math.random() * resting.length)]
    if (b) this.audio.song(b.variant.voice, this.mode === 'title' && Math.random() < 0.5 ? 'carol' : 'chatter', { ...this.spatial(b.pos), gain: 0.7 })
  }

  private advanceTutorial(done: Hint): void {
    if (this.tutorial < 0 || TUTORIAL[this.tutorial] !== done) return
    this.tutorial += 1
    this.tutorialTimer = 0
    this.hooks.hint(TUTORIAL[this.tutorial] ?? null)
  }

  private updateTutorial(dt: number): void {
    if (this.tutorial < 0) return
    this.tutorialTimer += dt
    const step = TUTORIAL[this.tutorial]
    if (step === 'fly' && this.tutorialTimer > 5) this.advanceTutorial('fly')
    if (step === 'nest' && this.tutorialTimer > 6) {
      this.tutorial = -1
      this.hooks.hint(null)
      this.hooks.tutorialDone()
    }
  }

  private finish(): void {
    this.mode = 'ended'
    this.hooks.hint(null)
    this.world.setNestAlert(0)
    if (this.run.phase === 'won') {
      this.audio.play('win')
      this.flock.forEach((b, i) => window.setTimeout(() => this.audio.song(b.variant.voice, 'carol', { gain: 0.8 - i * 0.15, pan: (i - 1) * 0.5 }), 300 + i * 450))
    } else {
      this.audio.play('lose')
      this.audio.song(this.bird.variant.voice, 'alarm')
    }
    this.hooks.end(this.run)
  }

  /** Stereo position for a sound at world position `at`, relative to the camera. */
  spatial(at: THREE.Vector3): Spatial {
    const cam = this.cam.camera
    this.v.copy(at).sub(cam.position)
    const dist = this.v.length()
    this.right.setFromMatrixColumn(cam.matrixWorld, 0)
    const pan = dist > 0.01 ? this.v.dot(this.right) / dist : 0
    return { pan: pan * 0.8, distance: Math.min(1, dist / 70), gain: 1 / (1 + dist / 30) }
  }

  /** Project to CSS pixels; off-screen points fall back to `fallback` (fractions of the view). */
  screen(at: THREE.Vector3, fallback: Point): Point {
    const ndc = this.v.copy(at).project(this.cam.camera)
    if (ndc.z > 1 || Math.abs(ndc.x) > 1.1 || Math.abs(ndc.y) > 1.1) return { x: innerWidth * fallback.x, y: innerHeight * fallback.y }
    return { x: ((ndc.x + 1) / 2) * innerWidth, y: ((1 - ndc.y) / 2) * innerHeight }
  }

  private chaseTarget() {
    const b = this.bird
    return { position: b.model.root.position.lengthSq() > 0 ? b.model.root.position : b.pos, yaw: b.yaw, pitch: b.pitch, speed: b.speed, swooping: b.mode === 'swoop' }
  }

  render(alpha: number, frameSeconds: number): void {
    this.time += frameSeconds
    for (const b of this.flock) b.render(this.mode === 'paused' ? 1 : alpha)
    this.crowd.render(this.mode === 'paused' ? 1 : alpha)
    const b = this.bird
    if (this.mode === 'title') this.cam.orbit(this.world.nestPosition, this.time, frameSeconds)
    else this.cam.follow({ position: b.model.root.position, yaw: b.yaw, pitch: b.pitch, speed: b.speed, swooping: b.mode === 'swoop' }, frameSeconds, this.reducedMotion)
    this.world.update(this.mode === 'title' ? this.world.nestPosition : b.model.root.position, frameSeconds)
    this.fx.update(frameSeconds)
    const flying = this.mode === 'playing' && b.mode !== 'perch'
    this.audio.setFlight(flying ? (b.speed - 5) / 18 : 0, flying && b.mode === 'swoop')
    this.candidate = this.mode === 'playing' && b.mode === 'fly' && !b.tired ? this.pickTarget(b) : null
    this.renderer.render(this.world.scene, this.cam.camera)
  }

  hud(): HudStatus {
    const b = this.bird
    let intruder: HudStatus['intruder'] = null
    let best = Infinity
    for (const p of this.crowd.people) {
      if (!p.intruder || !p.alive) continue
      const dx = p.pos.x - b.pos.x
      const dz = p.pos.z - b.pos.z
      const d = Math.hypot(dx, dz)
      if (d < best) {
        best = d
        intruder = { angle: angleDelta(b.yaw, Math.atan2(-dx, -dz)), distance: d }
      }
    }
    const target = b.mode === 'swoop' && b.target ? (b.target as Person) : this.candidate
    let lock: HudStatus['lock'] = null
    if (target && this.mode === 'playing') {
      const ndc = this.v.copy(target.aim).project(this.cam.camera)
      if (ndc.z < 1 && Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1) lock = { x: ((ndc.x + 1) / 2) * innerWidth, y: ((1 - ndc.y) / 2) * innerHeight, locked: b.mode === 'swoop' }
    }
    return {
      flock: this.flock.map((bird, i) => ({ variant: bird.variant, stamina: bird.stamina, tired: bird.tired, active: i === this.active, mode: bird.mode })),
      intruder,
      lock,
      carolActive: this.run.carolTime > 0,
      carolReady: 1 - this.run.carolCooldown / CONFIG.carol.cooldown,
    }
  }
}
