import * as THREE from 'three'
import { CONFIG } from './config'
import { PARK, ROUTES, WHEELED, rng, type PersonKind, type Route } from './park'

const BOARDS = ['#ffffff', '#ffd400', '#ff6a3d', '#3fd0ff', '#9be15d', '#ff4f8b']
const SPEED: Record<PersonKind, () => number> = {
  runner: () => CONFIG.people.runnerSpeed,
  cyclist: () => CONFIG.people.cyclistSpeed,
  surfer: () => CONFIG.people.surferSpeed,
  scooter: () => CONFIG.people.scooterSpeed,
}

/**
 * Runners, cyclists, surfers and e-scooter riders: procedural low-poly rigs, path following on the park routes, and the
 * classic swooping-season reactions — duck, arms over the head, wobble, then flee the park.
 */
export type PersonState = 'travel' | 'flee' | 'gone'

const matCache = new Map<string, THREE.MeshStandardMaterial>()
function mat(color: string): THREE.MeshStandardMaterial {
  let m = matCache.get(color)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.75 })
    matCache.set(color, m)
  }
  return m
}

function box(w: number, h: number, d: number, color: string, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color))
  m.position.set(0, y, z)
  m.castShadow = true
  return m
}

function ball(r: number, color: string, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat(color))
  m.position.set(0, y, z)
  m.castShadow = true
  return m
}

/** Thin cylinder between two points (bike frames). */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, color: string): THREE.Mesh {
  const len = a.distanceTo(b)
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat(color))
  m.position.copy(a).add(b).multiplyScalar(0.5)
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
  m.castShadow = true
  return m
}

const SKIN = ['#f1c7a5', '#e0ac85', '#c68a62', '#9a6545', '#6e4630']
const SHIRTS = ['#e8ff3a', '#ff4f8b', '#20c4b4', '#ff8a1f', '#2a4fd6', '#e23b3b', '#7b4fe0', '#ffffff']
const BOTTOMS = ['#1c1f2b', '#2d3446', '#3a2f48', '#0f4a5c']
const HELMETS = ['#ff3b30', '#ffffff', '#1e88e5', '#ffd400', '#1b1b1b', '#00c853']
const HAIR = ['#2b1d14', '#5a3a22', '#d9b86a', '#141414', '#8b4a2b']

type Limb = { upper: THREE.Group; lower: THREE.Group }

function limb(parent: THREE.Object3D, x: number, y: number, upperLen: number, lowerLen: number, w: number, upperColor: string, lowerColor: string, foot?: string): Limb {
  const upper = new THREE.Group()
  upper.position.set(x, y, 0)
  upper.add(box(w, upperLen, w, upperColor, -upperLen / 2))
  const lower = new THREE.Group()
  lower.position.y = -upperLen
  lower.add(box(w * 0.85, lowerLen, w * 0.85, lowerColor, -lowerLen / 2))
  if (foot) lower.add(box(w * 0.95, 0.08, w * 1.9, foot, -lowerLen - 0.02, -w * 0.4))
  upper.add(lower)
  parent.add(upper)
  return { upper, lower }
}

/** Two-bone IK in the leg's sagittal plane: returns [hip, knee] rotations about X. */
export function legIK(dy: number, dz: number, l1: number, l2: number): [number, number] {
  const d = Math.min(Math.hypot(dy, dz), l1 + l2 - 1e-3)
  const base = Math.atan2(-dz, -dy)
  const a = Math.acos(THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1))
  const b = Math.acos(THREE.MathUtils.clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1))
  return [base + a, -(Math.PI - b)]
}

class Rig {
  readonly root = new THREE.Group()
  readonly hips = new THREE.Group()
  readonly torso = new THREE.Group()
  readonly head = new THREE.Group()
  arms!: [Limb, Limb]
  legs!: [Limb, Limb]
  readonly wheels: THREE.Object3D[] = []
  board: THREE.Object3D | null = null
  /** Height of the head centre above the ground (what a magpie aims at). */
  headY = 1.62

  constructor(readonly kind: PersonKind, random: () => number) {
    const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)]
    const skin = pick(SKIN)
    const shirt = pick(SHIRTS)
    const bottom = pick(BOTTOMS)
    this.root.add(this.hips)
    this.hips.add(this.torso)
    this.torso.add(box(0.4, 0.56, 0.24, shirt, 0.3))
    this.head.position.y = 0.66
    this.torso.add(this.head)
    this.head.add(ball(0.14, skin, 0.08))
    this.hips.add(box(0.38, 0.2, 0.25, bottom, -0.02))
    this.arms = [-1, 1].map(side => limb(this.torso, side * 0.26, 0.55, 0.3, 0.28, 0.09, side < 0 ? shirt : shirt, skin)) as [Limb, Limb]
    const bareLegs = (kind === 'runner' || kind === 'surfer') && random() < 0.5
    this.legs = [-1, 1].map(side => limb(this.hips, side * 0.11, -0.06, 0.45, 0.45, 0.13, bareLegs ? skin : bottom, skin, kind === 'surfer' ? skin : pick(['#fafafa', '#ff5a1f', '#222', '#3fd0ff']))) as [Limb, Limb]

    if (kind === 'surfer') {
      this.hips.position.y = 0.96
      const hair = ball(0.15, pick(['#d9b86a', '#e8cf8a', '#5a3a22', '#2b1d14']), 0.13, 0.02)
      hair.scale.set(1.08, 0.75, 1.12)
      this.head.add(hair)
      // Surfboard carried under the left arm, nose forward.
      const board = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.5, 3, 8), mat(pick(BOARDS)))
      board.scale.set(1, 1, 0.22)
      board.rotation.set(Math.PI / 2, 0, Math.PI / 2)
      board.position.set(-0.36, 0.25, -0.1)
      board.rotation.set(Math.PI / 2 - 0.15, 0, 0)
      board.castShadow = true
      const stripe = box(0.05, 1.7, 0.06, '#1b1b1b')
      board.add(stripe)
      this.torso.add(board)
      this.board = board
    } else if (kind === 'scooter') {
      this.headY = 1.92
      this.buildScooter(random)
      const helmet = ball(0.165, pick(HELMETS), 0.13)
      helmet.scale.set(1, 0.8, 1.1)
      if (random() < 0.6) this.head.add(helmet)
      else this.head.add(ball(0.15, pick(HAIR), 0.13, 0.02))
    } else if (kind === 'runner') {
      this.hips.position.y = 0.96
      if (random() < 0.45) {
        // Cap, sometimes with the anti-magpie eyes drawn on the back.
        const capColor = pick(HELMETS)
        this.head.add(ball(0.145, capColor, 0.12))
        this.head.add(box(0.2, 0.025, 0.14, capColor, 0.11, -0.16))
        if (random() < 0.5) {
          for (const side of [-1, 1]) {
            const eye = ball(0.035, '#ffffff', 0.12, 0.13)
            eye.position.x = side * 0.06
            const pupil = ball(0.018, '#111111', 0.12, 0.16)
            pupil.position.x = side * 0.06
            this.head.add(eye, pupil)
          }
        }
      } else {
        const hair = ball(0.15, pick(HAIR), 0.13, 0.02)
        hair.scale.set(1, 0.7, 1.05)
        this.head.add(hair)
        if (random() < 0.5) this.head.add(ball(0.06, pick(HAIR), 0.07, 0.17))
      }
    } else {
      this.headY = 1.48
      this.buildBike(random, pick(HELMETS))
      const helmet = ball(0.165, pick(HELMETS), 0.13)
      helmet.scale.set(1, 0.75, 1.15)
      this.head.add(helmet)
      if (random() < 0.35) {
        // Cable ties poking out of the helmet: the classic Aussie magpie deterrent.
        for (let i = 0; i < 9; i += 1) {
          const a = (i / 9) * Math.PI * 2
          const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.01, 0.16, 3), mat('#f4f4f4'))
          tie.position.set(Math.cos(a) * 0.09, 0.24, Math.sin(a) * 0.1)
          tie.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5)
          this.head.add(tie)
        }
      }
    }
  }

  private buildBike(random: () => number, color: string): void {
    const frame = random() < 0.5 ? color : '#c9ced6'
    const bike = new THREE.Group()
    const V = (y: number, z: number) => new THREE.Vector3(0, y, z)
    const rear = V(0.34, 0.52)
    const front = V(0.34, -0.55)
    const crank = V(0.32, 0)
    const seat = V(0.92, 0.18)
    const head = V(0.95, -0.4)
    bike.add(rod(rear, crank, 0.02, frame), rod(crank, seat, 0.025, frame), rod(seat, head, 0.025, frame), rod(crank, head, 0.03, frame))
    bike.add(rod(rear, seat, 0.018, frame), rod(head, front, 0.022, '#9aa0a8'))
    bike.add(rod(V(1.03, -0.36), V(1.03, -0.5), 0.02, '#333'))
    const bar = rod(new THREE.Vector3(-0.22, 1.05, -0.48), new THREE.Vector3(0.22, 1.05, -0.48), 0.018, '#222')
    const saddle = box(0.12, 0.05, 0.24, '#151515', 0.95, 0.2)
    bike.add(bar, saddle)
    for (const at of [rear, front]) {
      const wheel = new THREE.Group()
      wheel.position.copy(at)
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.035, 6, 20), mat('#1a1a1a'))
      tyre.rotation.y = Math.PI / 2
      tyre.castShadow = true
      wheel.add(tyre)
      for (let i = 0; i < 3; i += 1) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.64, 0.012), mat('#b8bec6'))
        spoke.rotation.x = (i / 3) * Math.PI
        wheel.add(spoke)
      }
      bike.add(wheel)
      this.wheels.push(wheel)
    }
    this.root.add(bike)
    this.hips.position.set(0, 1.0, 0.16)
    this.torso.rotation.x = -0.75
  }

  private buildScooter(random: () => number): void {
    const color = ['#1b1b1b', '#e8e8e8', '#00b2a9', '#ff6a1f'][Math.floor(random() * 4)]
    const scooter = new THREE.Group()
    const V = (y: number, z: number) => new THREE.Vector3(0, y, z)
    const deck = box(0.18, 0.06, 0.95, color, 0.16, 0.05)
    scooter.add(deck)
    scooter.add(rod(V(0.18, -0.42), V(1.12, -0.5), 0.025, '#9aa0a8'))
    scooter.add(rod(new THREE.Vector3(-0.24, 1.12, -0.5), new THREE.Vector3(0.24, 1.12, -0.5), 0.018, '#222'))
    for (const z of [-0.45, 0.48]) {
      const wheel = new THREE.Group()
      wheel.position.set(0, 0.1, z)
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.03, 6, 12), mat('#1a1a1a'))
      tyre.rotation.y = Math.PI / 2
      wheel.add(tyre)
      scooter.add(wheel)
      this.wheels.push(wheel)
    }
    this.root.add(scooter)
    // Standing on the deck, one foot forward.
    this.hips.position.set(0, 1.12, 0.05)
    this.torso.rotation.x = -0.12
  }

  /** Animate one frame. `cycle` is the gait/crank phase, `panic` 0..1 arms-over-head. */
  pose(cycle: number, speed: number, panic: number, duck: number, wobble: number, time: number): void {
    const [armL, armR] = this.arms
    const [legL, legR] = this.legs
    if (this.kind === 'scooter') {
      this.hips.position.y = 1.12 - duck * 0.14
      this.torso.rotation.x = -0.12 - duck * 0.5
      legL.upper.rotation.x = -0.18
      legL.lower.rotation.x = 0.1 - duck * 0.4
      legR.upper.rotation.x = 0.22
      legR.lower.rotation.x = -0.1 - duck * 0.4
      armL.upper.rotation.set(1.25, 0, -0.1)
      armL.lower.rotation.x = 0.2
      armR.upper.rotation.set(THREE.MathUtils.lerp(1.25, 2.9 + Math.sin(time * 16) * 0.3, panic), 0, THREE.MathUtils.lerp(0.1, 0.4, panic))
      armR.lower.rotation.x = THREE.MathUtils.lerp(0.2, 0.6, panic)
      this.root.rotation.z = wobble
      for (const w of this.wheels) w.rotation.x -= speed * 0.12
    } else if (this.kind === 'runner' || this.kind === 'surfer') {
      const swing = Math.sin(cycle) * (this.kind === 'surfer' ? 0.6 : 1)
      this.hips.position.y = 0.96 + Math.abs(Math.cos(cycle)) * 0.05 * Math.min(1, speed / 3) - duck * 0.12
      this.torso.rotation.x = -0.12 - duck * 0.45
      legL.upper.rotation.x = swing * 0.8
      legR.upper.rotation.x = -swing * 0.8
      legL.lower.rotation.x = -(0.25 + 0.9 * (0.5 + 0.5 * Math.sin(cycle - 1.6)))
      legR.lower.rotation.x = -(0.25 + 0.9 * (0.5 + 0.5 * Math.sin(cycle + Math.PI - 1.6)))
      const flail = Math.sin(time * 18) * 0.25
      armL.upper.rotation.set(THREE.MathUtils.lerp(-swing * 0.65, 2.75 + flail, panic), 0, THREE.MathUtils.lerp(-0.08, -0.45, panic))
      armR.upper.rotation.set(THREE.MathUtils.lerp(swing * 0.65, 2.75 - flail, panic), 0, THREE.MathUtils.lerp(0.08, 0.45, panic))
      armL.lower.rotation.x = armR.lower.rotation.x = THREE.MathUtils.lerp(1.3, 0.9, panic)
      if (this.board) {
        armL.upper.rotation.set(THREE.MathUtils.lerp(0.25, 2.75, panic * 0.4), 0, -0.35)
        armL.lower.rotation.x = 1.2
        this.board.rotation.z = panic * 0.5
      }
    } else {
      // Pedal: feet follow the crank circle, legs solved with IK from the hip on the saddle.
      for (const [i, leg] of [legL, legR].entries()) {
        const c = cycle + i * Math.PI
        const footY = 0.36 + Math.sin(c) * 0.17 - (this.hips.position.y - 0.06)
        const footZ = Math.cos(c) * 0.17 - this.hips.position.z
        const [hip, knee] = legIK(footY, footZ, 0.45, 0.45)
        leg.upper.rotation.x = hip
        leg.lower.rotation.x = knee
      }
      this.torso.rotation.x = -0.75 - duck * 0.35
      // Hands on the bars; one arm swats at the bird in a panic.
      armL.upper.rotation.set(1.05, 0, -0.1)
      armL.lower.rotation.x = 0.35
      armR.upper.rotation.set(THREE.MathUtils.lerp(1.05, 2.9 + Math.sin(time * 16) * 0.3, panic), 0, THREE.MathUtils.lerp(0.1, 0.4, panic))
      armR.lower.rotation.x = THREE.MathUtils.lerp(0.35, 0.6, panic)
      this.root.rotation.z = wobble
      for (const w of this.wheels) w.rotation.x -= speed * 0.05
    }
    this.head.rotation.x = duck * 0.5
  }
}

let nextId = 1

export class Person {
  readonly id = nextId++
  readonly rig: Rig
  readonly pos = new THREE.Vector3()
  readonly prev = new THREE.Vector3()
  /** Where a swooping magpie aims: the top of the head. */
  readonly aim = new THREE.Vector3()
  heading = 0
  state: PersonState = 'travel'
  speed: number
  /** A magpie is inside the scare radius right now (decided by the game). */
  threat = false
  scored = false
  inNest = false
  /** Entered the nest zone unchallenged. */
  intruder = false
  private s: number
  private cycle = Math.random() * 6
  private panic = 0
  private duck = 0
  private wobble = 0
  private shock = 0
  private fleeYaw = 0
  private time = 0

  constructor(readonly kind: PersonKind, readonly route: Route, readonly dir: 1 | -1, s: number, random: () => number) {
    this.rig = new Rig(kind, random)
    const base = SPEED[kind]()
    this.speed = base * (0.85 + random() * 0.3)
    this.s = s
    this.place()
    this.prev.copy(this.pos)
  }

  get alive(): boolean {
    return this.state === 'travel'
  }

  private place(): void {
    const along = this.dir === 1 ? this.s : this.route.length - this.s
    const p = this.route.sample(along)
    const tx = p.tx * this.dir
    const tz = p.tz * this.dir
    // Keep left (it's Australia): cyclists near the centre line, runners at the edge.
    const lane = WHEELED.includes(this.kind) ? 0.6 : Math.min(1.3, this.route.def.width / 2 - 0.3)
    // Left of the travel direction (tx, tz) is (tz, -tx).
    this.pos.set(p.x + tz * lane, 0, p.z - tx * lane)
    this.heading = Math.atan2(-tx, -tz)
  }

  /** Startle and run for the park gate, away from the bird. */
  flee(from: THREE.Vector3, hit: boolean): void {
    if (this.state !== 'travel') return
    this.state = 'flee'
    this.scored = true
    this.threat = false
    this.intruder = false
    const away = Math.atan2(-(this.pos.x - from.x), -(this.pos.z - from.z))
    const outward = Math.atan2(-this.pos.x, -this.pos.z)
    // Mostly away from the bird, biased towards leaving the park.
    const blend = Math.atan2(Math.sin(away) * 0.6 + Math.sin(outward) * 0.4, Math.cos(away) * 0.6 + Math.cos(outward) * 0.4)
    this.fleeYaw = blend
    this.speed *= CONFIG.people.fleeBoost
    this.shock = hit ? 1 : 0.6
  }

  step(dt: number): void {
    this.prev.copy(this.pos)
    this.time += dt
    if (this.state === 'travel') {
      this.s += this.speed * dt
      if (this.s >= this.route.length) {
        this.state = 'gone'
        return
      }
      this.place()
    } else if (this.state === 'flee') {
      const d = Math.atan2(Math.sin(this.fleeYaw - this.heading), Math.cos(this.fleeYaw - this.heading))
      this.heading += d * Math.min(1, dt * 4)
      this.pos.x += -Math.sin(this.heading) * this.speed * dt
      this.pos.z += -Math.cos(this.heading) * this.speed * dt
      if (Math.hypot(this.pos.x, this.pos.z) > PARK.gate + 6) this.state = 'gone'
    }
    const scared = this.threat || this.state === 'flee'
    this.panic += ((scared ? 1 : 0) - this.panic) * (1 - Math.exp(-(scared ? 12 : 3) * dt))
    this.duck += ((this.threat ? 1 : this.shock > 0.3 ? 0.6 : 0) - this.duck) * (1 - Math.exp(-10 * dt))
    this.shock = Math.max(0, this.shock - dt * 0.8)
    this.wobble = WHEELED.includes(this.kind) ? Math.sin(this.time * 9) * 0.16 * Math.max(this.shock, this.threat ? 0.5 : 0) : 0
    this.cycle += dt * (WHEELED.includes(this.kind) ? this.speed * 1.25 : this.speed * (this.kind === 'surfer' ? 2.8 : 2.3))
    this.aim.set(this.pos.x, this.rig.headY + 0.15, this.pos.z)
  }

  render(alpha: number): void {
    const r = this.rig.root
    r.position.lerpVectors(this.prev, this.pos, alpha)
    r.rotation.y = this.heading
    this.rig.pose(this.cycle, this.speed, this.panic, this.duck, this.wobble, this.time)
  }
}

/** Spawns people on the routes, ramping up through the season, and removes them when gone. */
export class Crowd {
  readonly people: Person[] = []
  private timer = 0
  private random = rng(4242)

  constructor(private scene: THREE.Scene) {}

  setScene(scene: THREE.Scene): void {
    for (const p of this.people) this.scene.remove(p.rig.root)
    this.scene = scene
    for (const p of this.people) scene.add(p.rig.root)
  }

  reset(seed: number): void {
    for (const p of this.people) this.remove(p)
    this.people.length = 0
    this.random = rng(seed)
    this.timer = 1.5
    // A few people already out, none of them inside the nest zone yet.
    for (let i = 0; i < 5; i += 1) this.spawn(0.12 + this.random() * 0.22)
  }

  private spawn(fraction = 0): Person | null {
    const route = ROUTES[Math.floor(this.random() * ROUTES.length)]
    const kinds = route.def.kinds
    const kind = kinds[Math.floor(this.random() * kinds.length)]
    const dir: 1 | -1 = this.random() < 0.5 ? 1 : -1
    const person = new Person(kind, route, dir, fraction * route.length, this.random)
    this.people.push(person)
    this.scene.add(person.rig.root)
    return person
  }

  /** `progress` 0..1 through the season drives the spawn rate and crowd size. */
  step(dt: number, progress: number): void {
    const P = CONFIG.people
    const max = Math.round(THREE.MathUtils.lerp(P.max, P.maxLate, progress))
    const every = THREE.MathUtils.lerp(P.spawnEvery, P.spawnEveryLate, progress)
    this.timer -= dt
    const travelling = this.people.filter(p => p.state === 'travel').length
    if (this.timer <= 0 && travelling < max) {
      this.spawn()
      this.timer = every * (0.7 + this.random() * 0.6)
    }
    for (const p of this.people) p.step(dt)
    for (let i = this.people.length - 1; i >= 0; i -= 1) {
      if (this.people[i].state === 'gone') {
        this.remove(this.people[i])
        this.people.splice(i, 1)
      }
    }
  }

  private remove(p: Person): void {
    this.scene.remove(p.rig.root)
    // Materials are shared from the cache; geometry is per person.
    p.rig.root.traverse(o => (o as THREE.Mesh).geometry?.dispose())
  }

  render(alpha: number): void {
    for (const p of this.people) p.render(alpha)
  }
}
