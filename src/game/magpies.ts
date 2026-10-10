import * as THREE from 'three'

/**
 * The flock: three Australian magpies with different plumage and handling, plus a procedural
 * low-poly model whose colours are painted per vertex from each variant's plumage functions.
 */
export type VariantId = 'pied' | 'mottled' | 'black'

export type Voice = {
  /** Multiplies every note's pitch: juveniles squeak higher, big black-backs sing lower. */
  pitch: number
  /** Seeds the phrase generator so each bird has its own recognisable carol. */
  seed: number
  /** 0 = pure flute-like tone, 1 = raspy juvenile begging. */
  rasp: number
}

export type Variant = {
  id: VariantId
  /** i18n keys for the HUD and title cards. */
  nameKey: string
  traitKey: string
  /** Handling multipliers (1 = baseline). */
  speed: number
  agility: number
  scare: number
  hit: number
  /** Stamina cost multiplier for boosting and swooping. */
  drain: number
  voice: Voice
  /** CSS colours for HUD swatches: [main, accent]. */
  swatch: [string, string]
  paint: Plumage
}

export type Plumage = {
  /** Unit-sphere coordinates: x lateral, y up, z back (front of the bird is -z). */
  body(x: number, y: number, z: number): THREE.Color
  head(x: number, y: number, z: number): THREE.Color
  /** t: 0 root → 1 tip; c: 0 leading edge → 1 trailing edge. */
  wing(t: number, c: number): THREE.Color
  /** t: 0 base → 1 tip; u: −1..1 across. */
  tail(t: number, u: number): THREE.Color
  beak: string
  eye: string
}

const C = (hex: string) => new THREE.Color(hex)
const INK = C('#141418')
const SHEEN = C('#1d1f2b')
const WHITE = C('#f3f1ea')
const CREAM = C('#e6e1d4')

/** Deterministic speckle noise in [0, 1). */
function speckle(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return s - Math.floor(s)
}

const black = (x: number, y: number, z: number) => (speckle(x, y, z) > 0.75 ? SHEEN : INK)

const PIED: Plumage = {
  // White-backed: white from the nape all the way over the back and rump.
  body: (x, y, z) => {
    if (y > 0.05 - Math.abs(x) * 0.25 && z > -0.85) return WHITE
    if (z > 0.6 && y < 0.15) return WHITE
    return black(x, y, z)
  },
  head: (x, y, z) => (z > 0.55 && y > -0.1 ? WHITE : black(x, y, z)),
  wing: (t, c) => (t < 0.78 && c < 0.55 ? WHITE : INK),
  tail: t => (t < 0.6 ? WHITE : INK),
  beak: '#dfe3e8',
  eye: '#9a2f17',
}

const BLACK: Plumage = {
  // Black-backed: only a white nape band, small rump patch and shoulder flashes.
  body: (x, y, z) => {
    if (y > 0.1 && z > -0.9 && z < -0.5) return WHITE
    if (z > 0.72 && y > -0.1 && y < 0.5) return WHITE
    if (z > 0.8 && y <= -0.1) return CREAM
    return black(x, y, z)
  },
  head: (x, y, z) => (z > 0.7 && y > 0.1 ? WHITE : black(x, y, z)),
  wing: (t, c) => (t < 0.42 && c < 0.32 ? WHITE : INK),
  tail: t => (t < 0.45 ? WHITE : INK),
  beak: '#d3d8de',
  eye: '#8a2414',
}

const JUV_DARK = C('#4b443c')
const JUV_MID = C('#7a7064')
const JUV_LIGHT = C('#c2b9aa')
const mottle = (x: number, y: number, z: number, light: number) => {
  const n = speckle(x * 3.1, y * 2.7, z * 3.3)
  if (n < light * 0.6) return JUV_LIGHT
  if (n < light) return JUV_MID
  return JUV_DARK
}

const MOTTLED: Plumage = {
  // Juvenile: smudgy grey-brown everywhere, paler nape and back, speckled shoulder patch.
  body: (x, y, z) => {
    if (y > 0.1 && z > -0.9 && z < -0.45) return mottle(x, y, z, 0.85)
    if (y > 0.05) return mottle(x, y, z, 0.55)
    if (z > 0.7) return mottle(x, y, z, 0.8)
    return mottle(x, y, z, 0.35)
  },
  head: (x, y, z) => mottle(x, y, z, z > 0.5 ? 0.7 : 0.3),
  wing: (t, c) => (t < 0.62 && c < 0.48 ? mottle(t, c, 1, 0.8) : speckle(t, c, 2) > 0.85 ? JUV_MID : JUV_DARK),
  tail: (t, u) => (t < 0.55 ? mottle(t, u, 3, 0.85) : JUV_DARK),
  beak: '#9ea2a6',
  eye: '#3b2a20',
}

export const VARIANTS: Variant[] = [
  {
    id: 'pied', nameKey: 'bird.pied.name', traitKey: 'bird.pied.trait',
    speed: 1, agility: 1.25, scare: 1, hit: 1, drain: 1,
    voice: { pitch: 1, seed: 11, rasp: 0.05 }, swatch: ['#f3f1ea', '#141418'], paint: PIED,
  },
  {
    id: 'mottled', nameKey: 'bird.mottled.name', traitKey: 'bird.mottled.trait',
    speed: 0.95, agility: 1.05, scare: 1.3, hit: 0.9, drain: 0.8,
    voice: { pitch: 1.18, seed: 23, rasp: 0.45 }, swatch: ['#7a7064', '#c2b9aa'], paint: MOTTLED,
  },
  {
    id: 'black', nameKey: 'bird.black.name', traitKey: 'bird.black.trait',
    speed: 1.12, agility: 0.85, scare: 0.95, hit: 1.3, drain: 1.15,
    voice: { pitch: 0.86, seed: 37, rasp: 0.1 }, swatch: ['#141418', '#f3f1ea'], paint: BLACK,
  },
]

/**
 * Skins recolour a bird's own pattern (so a skinned juvenile still looks mottled and a skinned
 * black-back keeps its nape band) and may add a crest. Handling and voice never change.
 */
export type SkinId = 'skin_albino' | 'skin_golden' | 'skin_night' | 'skin_crested' | 'skin_aurora' | 'skin_sunset' | 'skin_frost'
export type Skin = {
  id: SkinId
  nameKey: string
  dark: string
  sheen: string
  light: string
  beak: string
  eye: string
  /** Eye glow (emissive intensity). */
  glow?: number
  crest?: string
  /** Swatch for UI cards: [main, accent]. */
  swatch: [string, string]
}

export const SKINS: Skin[] = [
  { id: 'skin_albino', nameKey: 'skin.albino', dark: '#e4ddd2', sheen: '#f2ebe0', light: '#ffffff', beak: '#efc2b4', eye: '#d0414b', glow: 0.4, swatch: ['#ffffff', '#e4ddd2'] },
  { id: 'skin_golden', nameKey: 'skin.golden', dark: '#1a1408', sheen: '#4a3508', light: '#f2b318', beak: '#ffd35c', eye: '#6b1d0a', swatch: ['#f2b318', '#1a1408'] },
  { id: 'skin_night', nameKey: 'skin.night', dark: '#0c1024', sheen: '#2a3478', light: '#7f8cff', beak: '#9aa3ff', eye: '#ff3b3b', glow: 1.6, swatch: ['#0c1024', '#7f8cff'] },
  { id: 'skin_crested', nameKey: 'skin.crested', dark: '#141418', sheen: '#1d1f2b', light: '#f3f1ea', beak: '#dfe3e8', eye: '#9a2f17', crest: '#ffcf4a', swatch: ['#ffcf4a', '#141418'] },
  { id: 'skin_aurora', nameKey: 'skin.aurora', dark: '#0d2a2a', sheen: '#1f6f62', light: '#9ff0d8', beak: '#c8fff0', eye: '#2ad1a3', glow: 0.9, swatch: ['#9ff0d8', '#0d2a2a'] },
  { id: 'skin_sunset', nameKey: 'skin.sunset', dark: '#2a0f1c', sheen: '#7a2a3a', light: '#ff9a5a', beak: '#ffd0a0', eye: '#ffde59', glow: 0.7, swatch: ['#ff9a5a', '#2a0f1c'] },
  { id: 'skin_frost', nameKey: 'skin.frost', dark: '#1e2c3a', sheen: '#56718a', light: '#dff4ff', beak: '#ffffff', eye: '#59c8ff', glow: 0.8, swatch: ['#dff4ff', '#1e2c3a'] },
]

export const skinById = (id: string | null | undefined): Skin | null => SKINS.find(s => s.id === id) ?? null

/** Plumage with the variant's pattern but the skin's colours. */
export function reskin(p: Plumage, skin: Skin): Plumage {
  const dark = C(skin.dark)
  const sheen = C(skin.sheen)
  const light = C(skin.light)
  const map = new Map<THREE.Color, THREE.Color>([
    [INK, dark],
    [SHEEN, sheen],
    [WHITE, light],
    [CREAM, light.clone().lerp(dark, 0.15)],
    [JUV_DARK, dark.clone().lerp(light, 0.22)],
    [JUV_MID, dark.clone().lerp(light, 0.5)],
    [JUV_LIGHT, dark.clone().lerp(light, 0.82)],
  ])
  const m = (c: THREE.Color) => map.get(c) ?? c
  return {
    body: (x, y, z) => m(p.body(x, y, z)),
    head: (x, y, z) => m(p.head(x, y, z)),
    wing: (t, c) => m(p.wing(t, c)),
    tail: (t, u) => m(p.tail(t, u)),
    beak: skin.beak,
    eye: skin.eye,
  }
}

/** Write a per-vertex colour attribute from a function of the vertex position. */
function paint(geometry: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => THREE.Color): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry
  const pos = g.attributes.position
  const colors = new Float32Array(pos.count * 3)
  // Colour each triangle from its centroid so patches have crisp low-poly edges.
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3
    const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3
    const c = fn(cx, cy, cz)
    for (let k = 0; k < 3; k += 1) c.toArray(colors, (i + k) * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  g.computeVertexNormals()
  return g
}

/** A tapered, slightly cambered wing panel: root at x = 0, extending to +x. */
function panel(len: number, root: number, tip: number, sweep: number, fn: (t: number, c: number) => THREE.Color): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 0.035, 1, 8, 1, 6)
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i += 1) {
    const t = pos.getX(i) + 0.5
    const c = pos.getZ(i) + 0.5
    const chord = root + (tip - root) * t
    pos.setXYZ(i, t * len, pos.getY(i) * (1 - 0.5 * t) + Math.sin(c * Math.PI) * 0.025, -0.3 * chord + c * chord + sweep * t)
  }
  // Paint in panel space (t, c) recovered from the deformed coordinates.
  return paint(g, (x, _y, z) => {
    const t = Math.min(1, Math.max(0, x / len))
    const chord = root + (tip - root) * t
    const c = Math.min(1, Math.max(0, (z - sweep * t + 0.3 * chord) / chord))
    return fn(t, c)
  })
}

const MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.42, metalness: 0.05 })

type Wing = { root: THREE.Group; outer: THREE.Group }

export type MagpiePose = {
  /** Wingbeat phase (radians) and amplitude (0 = gliding, 1 = full flap). */
  phase: number
  flap: number
  /** 0..1 wings swept back for a swoop dive. */
  tuck: number
  /** 0..1 wings folded on a perch. */
  fold: number
  headTurn: number
  tailBob: number
}

export class MagpieModel {
  readonly root = new THREE.Group()
  /** Pitch/roll pivot inside root (root carries world position and yaw). */
  readonly body = new THREE.Group()
  private readonly head = new THREE.Group()
  private readonly tail = new THREE.Group()
  private readonly legs = new THREE.Group()
  private readonly wings: [Wing, Wing]

  constructor(readonly variant: Variant, scale = 0.75, readonly skin: Skin | null = null) {
    const p = skin ? reskin(variant.paint, skin) : variant.paint
    this.root.add(this.body)
    this.body.scale.setScalar(scale)
    const mesh = (g: THREE.BufferGeometry, mat: THREE.Material = MATERIAL) => {
      const m = new THREE.Mesh(g, mat)
      m.castShadow = true
      return m
    }
    const SX = 0.3
    const SY = 0.28
    const SZ = 0.6
    const bodyGeo = new THREE.SphereGeometry(1, 16, 12)
    bodyGeo.scale(SX, SY, SZ)
    this.body.add(mesh(paint(bodyGeo, (x, y, z) => p.body(x / SX, y / SY, z / SZ))))

    this.head.position.set(0, 0.13, -0.55)
    this.body.add(this.head)
    const headGeo = new THREE.SphereGeometry(0.21, 12, 10)
    headGeo.scale(0.95, 0.95, 1.08)
    this.head.add(mesh(paint(headGeo, (x, y, z) => p.head(x / 0.2, y / 0.2, z / 0.22))))
    const beakGeo = new THREE.ConeGeometry(0.07, 0.32, 7)
    beakGeo.rotateX(-Math.PI / 2)
    beakGeo.translate(0, -0.03, -0.32)
    const beakColor = C(p.beak)
    this.head.add(mesh(paint(beakGeo, (_x, _y, z) => (z < -0.4 ? INK : beakColor))))
    const eyeMat = new THREE.MeshStandardMaterial({ color: p.eye, roughness: 0.2, emissive: p.eye, emissiveIntensity: skin?.glow ?? 0.25 })
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 6), eyeMat)
      eye.position.set(side * 0.15, 0.04, -0.1)
      this.head.add(eye)
    }

    if (skin?.crest) {
      // A swept-back crest of three feathers on the crown.
      const crestMat = new THREE.MeshStandardMaterial({ color: skin.crest, flatShading: true, roughness: 0.4, emissive: skin.crest, emissiveIntensity: 0.15 })
      for (let i = 0; i < 3; i += 1) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.3 - i * 0.05, 4), crestMat)
        f.position.set((i - 1) * 0.05, 0.2, 0.02 + i * 0.03)
        f.rotation.set(0.9 + i * 0.12, 0, (i - 1) * -0.25)
        f.castShadow = true
        this.head.add(f)
      }
    }
    this.tail.position.set(0, 0.04, 0.5)
    this.body.add(this.tail)
    const tailGeo = new THREE.BoxGeometry(1, 0.03, 1, 4, 1, 6)
    const tp = tailGeo.attributes.position
    for (let i = 0; i < tp.count; i += 1) {
      const t = tp.getZ(i) + 0.5
      const w = 0.17 + 0.17 * t
      tp.setXYZ(i, tp.getX(i) * 2 * w, tp.getY(i), t * 0.46)
    }
    this.tail.add(mesh(paint(tailGeo, (x, _y, z) => p.tail(Math.min(1, z / 0.46), x / 0.34))))

    const legMat = new THREE.MeshStandardMaterial({ color: '#2a2a2e', roughness: 0.8 })
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.26, 5), legMat)
      leg.position.set(side * 0.09, -0.36, 0.04)
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.16), legMat)
      foot.position.set(side * 0.09, -0.49, -0.02)
      this.legs.add(leg, foot)
    }
    this.body.add(this.legs)

    const makeWing = (side: 1 | -1): Wing => {
      const root = new THREE.Group()
      root.position.set(side * 0.2, 0.1, -0.12)
      const mirror = new THREE.Group()
      mirror.scale.x = side
      root.add(mirror)
      mirror.add(mesh(panel(0.52, 0.42, 0.36, 0.05, (t, c) => p.wing(t * 0.5, c))))
      const outer = new THREE.Group()
      outer.position.x = 0.5 * side
      root.add(outer)
      const outerMirror = new THREE.Group()
      outerMirror.scale.x = side
      outer.add(outerMirror)
      outerMirror.add(mesh(panel(0.5, 0.36, 0.13, 0.17, (t, c) => p.wing(0.5 + t * 0.5, c))))
      this.body.add(root)
      return { root, outer }
    }
    this.wings = [makeWing(1), makeWing(-1)]
    this.setPose({ phase: 0, flap: 0, tuck: 0, fold: 1, headTurn: 0, tailBob: 0 })
  }

  dispose(): void {
    this.root.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose()
        if (o.material !== MATERIAL) (o.material as THREE.Material).dispose()
      }
    })
  }

  setPose(p: MagpiePose): void {
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t
    const beat = Math.sin(p.phase) * p.flap
    const lag = Math.sin(p.phase - 0.9) * p.flap
    this.wings.forEach((wing, i) => {
      const side = i === 0 ? 1 : -1
      let innerLift = 0.12 + beat * 0.85
      let innerSweep = 0.06 - beat * 0.08
      let outerLift = 0.04 + lag * 0.55
      let outerSweep = 0.1
      innerLift = lerp(innerLift, 0.28, p.tuck)
      innerSweep = lerp(innerSweep, 0.8, p.tuck)
      outerLift = lerp(outerLift, -0.25, p.tuck)
      outerSweep = lerp(outerSweep, 0.75, p.tuck)
      innerLift = lerp(innerLift, -0.22, p.fold)
      innerSweep = lerp(innerSweep, 1.38, p.fold)
      outerLift = lerp(outerLift, 0.12, p.fold)
      outerSweep = lerp(outerSweep, 0.3, p.fold)
      wing.root.rotation.set(0, -side * innerSweep, side * innerLift)
      wing.outer.rotation.set(0, -side * outerSweep, side * outerLift)
    })
    this.body.position.y = -beat * 0.04
    this.head.rotation.set(0.15 * p.fold, p.headTurn, 0)
    this.tail.rotation.x = p.tailBob + 0.1 * p.tuck
    this.legs.visible = p.fold > 0.5
  }
}
