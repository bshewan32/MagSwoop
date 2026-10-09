import * as THREE from 'three'
import { CONFIG } from './config'
import { MagpieModel, type Variant } from './magpies'

/**
 * One magpie: arcade flight for the bird you control, and a simple autopilot that flies the
 * others home to their perch to rest. Pure kinematics (no physics engine): the bird always flies
 * forward, the player steers heading and pitch, and soft obstacles push it out of trees.
 */
export type BirdMode = 'fly' | 'swoop' | 'return' | 'perch'

export type BirdIntent = {
  /** −1..1 keyboard/stick steering: turn right is +, climb is +. */
  turn: number
  climb: number
  /** Look delta (radians) from mouse / right stick / touch drag. */
  lookX: number
  lookY: number
  boost: boolean
  flap: boolean
  swoop: boolean
}

export type Perch = { x: number; y: number; z: number; yaw: number }

/** Something the bird can lock on to and dive at. */
export type SwoopTarget = { readonly aim: THREE.Vector3; readonly alive: boolean }

export type Obstacles = {
  /** Vertical trunks: centre, radius and top height. */
  trunks: { x: number; z: number; r: number; top: number }[]
  /** Leafy canopy blobs the bird pushes out of (and rustles). */
  blobs: { x: number; y: number; z: number; r: number }[]
}

export type BirdEvent =
  | { type: 'flap' }
  | { type: 'swoop'; target: SwoopTarget | null }
  | { type: 'rustle'; at: THREE.Vector3 }
  | { type: 'tired' }
  | { type: 'edge' }

const tmp = new THREE.Vector3()

export function forwardOf(yaw: number, pitch: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
}

/** Shortest signed angle from a to b. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

export class Bird {
  readonly model: MagpieModel
  readonly pos = new THREE.Vector3()
  readonly prev = new THREE.Vector3()
  yaw = 0
  pitch = 0
  roll = 0
  speed = 0
  /** Extra vertical speed from flaps; decays quickly. */
  lift = 0
  stamina = 1
  tired = false
  mode: BirdMode = 'perch'
  swoopTime = 0
  swoopCooldown = 0
  target: SwoopTarget | null = null
  /** Visual-only state. */
  private wingPhase = 0
  private flapAmount = 0
  private flapBurst = 0
  private tuck = 0
  private fold = 1
  private idle = Math.random() * 10
  private yawRate = 0
  private rustleCooldown = 0

  constructor(readonly variant: Variant, readonly perch: Perch) {
    this.model = new MagpieModel(variant)
    this.land()
  }

  /** Snap to the perch (start of run / arrival). */
  land(): void {
    this.mode = 'perch'
    this.pos.set(this.perch.x, this.perch.y, this.perch.z)
    this.prev.copy(this.pos)
    this.yaw = this.perch.yaw
    this.pitch = 0
    this.roll = 0
    this.speed = 0
    this.lift = 0
    this.target = null
  }

  get maxStaminaRate(): number {
    return this.variant.drain
  }

  takeOff(): void {
    if (this.mode === 'perch') {
      this.speed = CONFIG.flight.cruiseSpeed * 0.75
      this.pitch = 0.25
      this.lift = 3
      this.flapBurst = 1
    }
    this.mode = 'fly'
    this.target = null
  }

  /** Hand control back to the autopilot, which flies home to rest. */
  release(): void {
    if (this.mode !== 'perch') this.mode = 'return'
    this.target = null
  }

  pullUp(): void {
    if (this.mode !== 'swoop') return
    this.mode = 'fly'
    this.target = null
    this.pitch = Math.max(this.pitch, 0.5)
    this.lift += 2.5
    this.swoopCooldown = CONFIG.swoop.cooldown
    this.flapBurst = 1
  }

  private spend(amount: number): void {
    this.stamina = Math.max(0, this.stamina - amount * this.variant.drain)
  }

  private updateTired(events: BirdEvent[]): void {
    if (!this.tired && this.stamina <= 0.02) {
      this.tired = true
      events.push({ type: 'tired' })
    } else if (this.tired && this.stamina >= 0.35) this.tired = false
  }

  /** Fixed step for the bird the player controls. */
  stepControlled(dt: number, intent: BirdIntent, obstacles: Obstacles, pickTarget: (bird: Bird) => SwoopTarget | null): BirdEvent[] {
    const events: BirdEvent[] = []
    const F = CONFIG.flight
    const S = CONFIG.swoop
    const v = this.variant
    this.prev.copy(this.pos)
    if (this.mode === 'perch' || this.mode === 'return') this.takeOff()
    this.swoopCooldown = Math.max(0, this.swoopCooldown - dt)
    this.rustleCooldown = Math.max(0, this.rustleCooldown - dt)

    if (intent.swoop && this.mode === 'fly' && this.swoopCooldown <= 0 && !this.tired) {
      this.target = pickTarget(this)
      this.mode = 'swoop'
      this.swoopTime = this.target ? S.duration * 1.7 : S.duration
      this.spend(S.cost)
      if (!this.target && this.pos.y > 3) this.pitch = Math.min(this.pitch, -0.45)
      this.flapBurst = 1
      events.push({ type: 'swoop', target: this.target })
    }

    const steer = this.mode === 'swoop' ? 0.35 : 1
    const yawInput = -intent.turn * F.turnRate * v.agility * dt * steer - intent.lookX * steer
    this.yaw += yawInput
    this.yawRate = THREE.MathUtils.lerp(this.yawRate, yawInput / dt, 1 - Math.exp(-8 * dt))
    const pitchInput = intent.climb * F.pitchRate * v.agility * dt * steer - intent.lookY * steer
    this.pitch += pitchInput
    if (this.mode === 'fly' && Math.abs(intent.climb) < 0.1 && Math.abs(intent.lookY) < 1e-4) this.pitch -= this.pitch * 0.9 * dt

    if (this.mode === 'swoop') {
      const target = this.target
      if (target && target.alive) {
        tmp.copy(target.aim).sub(this.pos)
        const desiredYaw = Math.atan2(-tmp.x, -tmp.z)
        const desiredPitch = Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z))
        const k = 1 - Math.exp(-S.homing * dt)
        this.yaw += angleDelta(this.yaw, desiredYaw) * k
        this.pitch += (desiredPitch - this.pitch) * k
      } else if (target) this.target = null
      this.swoopTime -= dt
      if (this.swoopTime <= 0) this.pullUp()
    }
    this.pitch = THREE.MathUtils.clamp(this.pitch, -F.maxPitch * (this.mode === 'swoop' ? 1.3 : 1), F.maxPitch)

    if (intent.flap && this.mode === 'fly' && this.stamina > 0.01) {
      this.lift = Math.min(this.lift + F.flapLift, F.flapLift * 1.6)
      this.spend(F.flapCost)
      this.flapBurst = 1
      events.push({ type: 'flap' })
    }

    const boosting = intent.boost && !this.tired && this.mode === 'fly' && this.stamina > 0
    let targetSpeed = this.tired ? F.tiredSpeed : boosting ? F.boostSpeed : F.cruiseSpeed
    if (this.mode === 'swoop') targetSpeed = S.speed
    targetSpeed *= v.speed
    const accel = this.mode === 'swoop' ? 30 : F.acceleration
    this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-accel * dt / 4))
    // Diving trades height for speed, climbing bleeds it.
    this.speed = Math.max(F.tiredSpeed * 0.7, this.speed - Math.sin(this.pitch) * 6 * dt)
    if (boosting) this.spend(F.boostDrain * dt)
    else if (this.mode === 'fly') this.stamina = Math.min(1, this.stamina + F.regenFlying * dt)
    this.updateTired(events)

    this.lift *= Math.exp(-2.5 * dt)
    forwardOf(this.yaw, this.pitch, tmp).multiplyScalar(this.speed)
    tmp.y += this.lift
    this.pos.addScaledVector(tmp, dt)

    // Ground and ceiling.
    if (this.pos.y < F.minHeight) {
      this.pos.y = F.minHeight
      if (this.pitch < 0) this.pitch *= 0.5
      if (this.mode === 'swoop' && !this.target) this.pullUp()
    }
    if (this.pos.y > F.maxHeight) {
      this.pos.y = F.maxHeight
      this.pitch = Math.min(this.pitch, 0)
    }

    // Territory edge: turn back towards the park.
    const r = Math.hypot(this.pos.x, this.pos.z)
    const soft = F.territory - 10
    if (r > soft) {
      const home = Math.atan2(this.pos.x, this.pos.z)
      const k = Math.min(1, (r - soft) / 10)
      this.yaw += angleDelta(this.yaw, home) * k * 2.5 * dt
      if (r > F.territory) {
        this.pos.x *= F.territory / r
        this.pos.z *= F.territory / r
        events.push({ type: 'edge' })
      }
    }

    this.collide(obstacles, events)
    this.roll = THREE.MathUtils.lerp(this.roll, THREE.MathUtils.clamp(this.yawRate * F.bank, -1.1, 1.1), 1 - Math.exp(-6 * dt))
    this.animateStep(dt, boosting || intent.climb > 0.3 || this.pitch > 0.35)
    return events
  }

  private collide(obstacles: Obstacles, events: BirdEvent[]): void {
    for (const t of obstacles.trunks) {
      if (this.pos.y > t.top) continue
      const dx = this.pos.x - t.x
      const dz = this.pos.z - t.z
      const d = Math.hypot(dx, dz)
      const min = t.r + 0.45
      if (d < min && d > 1e-4) {
        this.pos.x = t.x + (dx / d) * min
        this.pos.z = t.z + (dz / d) * min
        this.speed *= 0.97
      }
    }
    for (const b of obstacles.blobs) {
      tmp.set(this.pos.x - b.x, this.pos.y - b.y, this.pos.z - b.z)
      const d = tmp.length()
      if (d < b.r && d > 1e-4) {
        // Leaves slow the bird and nudge it out; a quick rustle, not a wall.
        this.pos.addScaledVector(tmp, ((b.r - d) / d) * 0.35)
        this.speed *= 0.985
        if (this.rustleCooldown <= 0) {
          this.rustleCooldown = 0.6
          events.push({ type: 'rustle', at: this.pos.clone() })
        }
      }
    }
  }

  /** Autopilot for birds the player is not flying: go home, perch, rest. */
  stepAI(dt: number): void {
    this.prev.copy(this.pos)
    const F = CONFIG.flight
    if (this.mode === 'perch') {
      this.stamina = Math.min(1, this.stamina + F.regenPerched * dt)
      if (this.tired && this.stamina >= 0.35) this.tired = false
      this.animateStep(dt, false)
      return
    }
    if (this.mode === 'swoop') this.pullUp()
    this.mode = 'return'
    this.stamina = Math.min(1, this.stamina + F.regenFlying * dt)
    tmp.set(this.perch.x - this.pos.x, this.perch.y - this.pos.y, this.perch.z - this.pos.z)
    const d = tmp.length()
    if (d < 0.25) {
      this.land()
      return
    }
    const desiredYaw = Math.atan2(-tmp.x, -tmp.z)
    const desiredPitch = Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z))
    const k = 1 - Math.exp(-(d < 8 ? 6 : 2.4) * dt)
    const before = this.yaw
    this.yaw += angleDelta(this.yaw, desiredYaw) * k
    this.yawRate = angleDelta(before, this.yaw) / dt
    this.pitch += (THREE.MathUtils.clamp(desiredPitch, -0.9, 0.9) - this.pitch) * k
    const targetSpeed = d < 8 ? Math.max(2.5, d * 1.4) : F.cruiseSpeed * 0.9
    this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-3 * dt))
    if (d < 3) this.pos.addScaledVector(tmp, Math.min(1, (this.speed * dt) / d))
    else this.pos.addScaledVector(forwardOf(this.yaw, this.pitch, tmp), this.speed * dt)
    this.pos.y = Math.max(this.pos.y, F.minHeight)
    this.roll = THREE.MathUtils.lerp(this.roll, THREE.MathUtils.clamp(this.yawRate * F.bank, -1, 1), 1 - Math.exp(-5 * dt))
    this.animateStep(dt, d < 6 || this.pitch > 0.2)
  }

  private animateStep(dt: number, flapping: boolean): void {
    const perched = this.mode === 'perch'
    this.flapBurst = Math.max(0, this.flapBurst - dt * 2.2)
    const wantFlap = perched ? 0 : Math.max(this.flapBurst, flapping ? 0.85 : 0.18 + 0.2 * Math.max(0, Math.sin(this.idle * 0.7)))
    this.flapAmount += (wantFlap - this.flapAmount) * (1 - Math.exp(-6 * dt))
    this.wingPhase += dt * (perched ? 0 : 10 + this.flapAmount * 8)
    this.tuck += ((this.mode === 'swoop' ? 1 : 0) - this.tuck) * (1 - Math.exp(-8 * dt))
    this.fold += ((perched ? 1 : 0) - this.fold) * (1 - Math.exp(-10 * dt))
    this.idle += dt
  }

  /** Copy interpolated state onto the model. */
  render(alpha: number): void {
    const root = this.model.root
    root.position.lerpVectors(this.prev, this.pos, alpha)
    root.rotation.set(0, this.yaw, 0)
    this.model.body.rotation.set(this.pitch, 0, this.roll, 'YXZ')
    const perched = this.mode === 'perch'
    const headTurn = perched ? Math.sin(this.idle * 0.9) * 0.6 * (Math.sin(this.idle * 0.37) > 0 ? 1 : -0.4) : -this.roll * 0.25
    this.model.setPose({
      phase: this.wingPhase,
      flap: this.flapAmount * (1 - this.tuck * 0.9),
      tuck: this.tuck,
      fold: this.fold,
      headTurn,
      tailBob: perched ? Math.max(0, Math.sin(this.idle * 2.3)) * 0.18 : -this.pitch * 0.3,
    })
  }
}
