/**
 * Pure park layout: paths people travel, tree and furniture placement, the nest tree and its
 * perches. No three.js here, so tests can check the layout (paths reach the gates, trees keep
 * clear of paths, nest-crossing routes really pass the nest).
 */
export type Pt = { x: number; z: number }
export type PersonKind = 'runner' | 'cyclist' | 'surfer' | 'scooter'
export type Surface = 'asphalt' | 'gravel' | 'concrete' | 'boardwalk' | 'sand'
export type LocationId = 'park' | 'beach'

/** Kinds that ride something with wheels (bells, wobble, faster). */
export const WHEELED: readonly PersonKind[] = ['cyclist', 'scooter']

export type ParkBounds = {
  /** Timber fence ring. People spawn outside it at `gate` and walk in through gaps. */
  fence: number
  gate: number
  nest: Pt
  /** Height of the nest in the nest tree. */
  nestHeight: number
}

export type RouteDef = { id: string; kinds: PersonKind[]; surface: Surface; width: number; points: Pt[] }

const BOUNDS: ParkBounds = { fence: 76, gate: 86, nest: { x: 0, z: 0 }, nestHeight: 8.6 }

const PARK_ROUTES: RouteDef[] = [
  {
    id: 'bikeway', kinds: ['cyclist'], surface: 'asphalt', width: 3.2,
    points: [{ x: -90, z: 4 }, { x: -62, z: 6 }, { x: -36, z: 11 }, { x: -16, z: 10 }, { x: 0, z: 8.5 }, { x: 16, z: 6 }, { x: 36, z: -2 }, { x: 62, z: -8 }, { x: 90, z: -10 }],
  },
  {
    id: 'jogtrack', kinds: ['runner'], surface: 'gravel', width: 2.4,
    points: [{ x: 6, z: -90 }, { x: 4, z: -60 }, { x: -4, z: -38 }, { x: -10, z: -18 }, { x: -9, z: -4 }, { x: -4, z: 14 }, { x: 2, z: 34 }, { x: 4, z: 60 }, { x: 2, z: 90 }],
  },
  {
    id: 'northarc', kinds: ['runner', 'cyclist'], surface: 'concrete', width: 2.8,
    points: [{ x: -66, z: -66 }, { x: -42, z: -42 }, { x: -18, z: -34 }, { x: 6, z: -34 }, { x: 28, z: -38 }, { x: 46, z: -48 }, { x: 66, z: -66 }],
  },
  {
    id: 'southarc', kinds: ['runner', 'cyclist'], surface: 'asphalt', width: 3,
    points: [{ x: -66, z: 66 }, { x: -44, z: 44 }, { x: -20, z: 35 }, { x: 0, z: 33 }, { x: 24, z: 36 }, { x: 44, z: 44 }, { x: 66, z: 66 }],
  },
]

/**
 * Beach Esplanade (Season+): grassy foreshore reserve on the west, the esplanade shared path
 * past the nest gum, sand from x = 22 and the surf from x = 52. Surfers walk from the car park
 * across the reserve to the water; e-scooters share the esplanade and the bike lane.
 */
const BEACH_ROUTES: RouteDef[] = [
  {
    id: 'esplanade', kinds: ['runner', 'cyclist', 'scooter'], surface: 'concrete', width: 4,
    points: [{ x: 16, z: -90 }, { x: 14, z: -62 }, { x: 9, z: -36 }, { x: 6, z: -12 }, { x: 6, z: 8 }, { x: 9, z: 30 }, { x: 14, z: 58 }, { x: 16, z: 90 }],
  },
  {
    id: 'bikelane', kinds: ['cyclist', 'scooter'], surface: 'asphalt', width: 3.2,
    points: [{ x: -30, z: -90 }, { x: -28, z: -50 }, { x: -24, z: -20 }, { x: -26, z: 10 }, { x: -30, z: 50 }, { x: -32, z: 90 }],
  },
  {
    id: 'surfwalk', kinds: ['surfer'], surface: 'boardwalk', width: 2.4,
    points: [{ x: -90, z: -30 }, { x: -56, z: -22 }, { x: -28, z: -10 }, { x: -8, z: -2 }, { x: 12, z: 8 }, { x: 28, z: 16 }, { x: 38, z: 30 }, { x: 40, z: 60 }, { x: 42, z: 92 }],
  },
  {
    id: 'shoreline', kinds: ['runner', 'surfer'], surface: 'sand', width: 2.6,
    points: [{ x: 32, z: -92 }, { x: 34, z: -50 }, { x: 30, z: -14 }, { x: 32, z: 20 }, { x: 36, z: 52 }, { x: 34, z: 92 }],
  },
]

export type LocationDef = {
  id: LocationId
  nameKey: string
  bounds: ParkBounds
  routes: RouteDef[]
  /** Where scenery trees may grow (beyond keeping clear of paths). */
  treeAllowed(x: number, z: number): boolean
  treeCount: number
  /** Sand starts here (beach only) and the water beyond `water`. */
  sandX?: number
  waterX?: number
}

export const LOCATIONS: Record<LocationId, LocationDef> = {
  park: { id: 'park', nameKey: 'location.park', bounds: BOUNDS, routes: PARK_ROUTES, treeAllowed: () => true, treeCount: 30 },
  beach: { id: 'beach', nameKey: 'location.beach', bounds: BOUNDS, routes: BEACH_ROUTES, treeAllowed: x => x < 18, treeCount: 22, sandX: 22, waterX: 52 },
}

/** Mulberry32: tiny deterministic RNG so the park is identical on every load. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Uniform Catmull–Rom through `points`, resampled every `step` metres of arc length. */
export function smooth(points: Pt[], step = 1): Pt[] {
  const dense: Pt[] = []
  const p = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))]
  for (let i = 0; i < points.length - 1; i += 1) {
    const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)]
    for (let k = 0; k < 24; k += 1) {
      const t = k / 24
      const t2 = t * t
      const t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      dense.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) })
    }
  }
  dense.push(points[points.length - 1])
  const out: Pt[] = [dense[0]]
  let carry = 0
  for (let i = 1; i < dense.length; i += 1) {
    const a = dense[i - 1]
    const b = dense[i]
    const seg = Math.hypot(b.x - a.x, b.z - a.z)
    let d = step - carry
    while (d <= seg) {
      const t = d / seg
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })
      d += step
    }
    carry = seg - (d - step)
  }
  const last = dense[dense.length - 1]
  const tail = out[out.length - 1]
  if (Math.hypot(last.x - tail.x, last.z - tail.z) > 0.2) out.push(last)
  return out
}

/** A smoothed path with arc-length lookup. */
export class Route {
  readonly pts: Pt[]
  readonly cum: number[]
  readonly length: number
  constructor(readonly def: RouteDef) {
    this.pts = smooth(def.points, 1)
    this.cum = [0]
    for (let i = 1; i < this.pts.length; i += 1) {
      const a = this.pts[i - 1]
      const b = this.pts[i]
      this.cum.push(this.cum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z))
    }
    this.length = this.cum[this.cum.length - 1]
  }

  private index(s: number): number {
    const c = this.cum
    let lo = 0
    let hi = c.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (c[mid] <= s) lo = mid
      else hi = mid
    }
    return lo
  }

  /** Point at arc length `s` (clamped) plus the unit tangent in travel direction. */
  sample(s: number): { x: number; z: number; tx: number; tz: number } {
    const cl = Math.max(0, Math.min(this.length, s))
    const i = Math.min(this.index(cl), this.pts.length - 2)
    const a = this.pts[i]
    const b = this.pts[i + 1]
    const seg = this.cum[i + 1] - this.cum[i] || 1
    const t = (cl - this.cum[i]) / seg
    const tx = (b.x - a.x) / seg
    const tz = (b.z - a.z) / seg
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx, tz }
  }

  /** Smallest distance from (x, z) to the path centre line. */
  distanceTo(x: number, z: number): number {
    let best = Infinity
    for (let i = 1; i < this.pts.length; i += 1) best = Math.min(best, segmentDistance(x, z, this.pts[i - 1], this.pts[i]))
    return best
  }
}

export function segmentDistance(x: number, z: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len2 = dx * dx + dz * dz || 1
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2))
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t))
}


/** Clearance from the nearest path edge (negative = on a path). */
export function pathClearance(x: number, z: number): number {
  let best = Infinity
  for (const r of ROUTES) best = Math.min(best, r.distanceTo(x, z) - r.def.width / 2)
  return best
}

export type TreeDef = { x: number; z: number; height: number; trunk: number; crown: number; lean: number; seed: number }

/** Gum trees scattered across the park, clear of paths, the nest tree and each other. */
export function planTrees(seed = 2024, count = LOCATION.treeCount): TreeDef[] {
  const random = rng(seed)
  const out: TreeDef[] = []
  let guard = 0
  while (out.length < count && guard < 5000) {
    guard += 1
    const a = random() * Math.PI * 2
    const r = 14 + Math.sqrt(random()) * 56
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (pathClearance(x, z) < 4.5 || !LOCATION.treeAllowed(x, z)) continue
    if (out.some(t => Math.hypot(t.x - x, t.z - z) < 9)) continue
    const height = 7 + random() * 5
    out.push({ x, z, height, trunk: 0.32 + random() * 0.18, crown: 3 + random() * 1.6, lean: (random() - 0.5) * 0.25, seed: Math.floor(random() * 1e9) })
  }
  return out
}

/** The big gum at the centre holding the nest. */
export const NEST_TREE: TreeDef = { x: BOUNDS.nest.x, z: BOUNDS.nest.z, height: 10.5, trunk: 0.62, crown: 4.4, lean: 0, seed: 77 }

/** Branch tips where resting magpies perch (world space), each with a facing yaw. */
export const PERCHES: { x: number; y: number; z: number; yaw: number }[] = [
  { x: 2.6, y: 9.4, z: 0.9, yaw: -1.3 },
  { x: -2.4, y: 9.1, z: 1.4, yaw: 1.5 },
  { x: 0.4, y: 9.9, z: -2.6, yaw: 0.2 },
]

export type Furniture = { kind: 'bench' | 'lamp' | 'bin'; x: number; z: number; yaw: number }

/** Benches, lamps and bins along the paths, set back from the edge. */
export function planFurniture(seed = 99): Furniture[] {
  const random = rng(seed)
  const out: Furniture[] = []
  for (const route of ROUTES) {
    for (let s = 14; s < route.length - 14; s += 13 + random() * 9) {
      const p = route.sample(s)
      if (Math.hypot(p.x, p.z) > PARK.fence - 6) continue
      if (LOCATION.waterX !== undefined && p.x > LOCATION.waterX - 6) continue
      const side = random() < 0.5 ? -1 : 1
      const nx = -p.tz * side
      const nz = p.tx * side
      const roll = random()
      const kind: Furniture['kind'] = roll < 0.45 ? 'lamp' : roll < 0.8 ? 'bench' : 'bin'
      const off = route.def.width / 2 + (kind === 'lamp' ? 0.9 : 1.6)
      const x = p.x + nx * off
      const z = p.z + nz * off
      if (pathClearance(x, z) < 0.5) continue
      if (out.some(f => Math.hypot(f.x - x, f.z - z) < 6)) continue
      // Benches face the path.
      out.push({ kind, x, z, yaw: Math.atan2(nx, nz) })
    }
  }
  return out
}


// ─── active location ─────────────────────────────────────────────────────
// Live ES-module bindings: modules importing these names see the current location after
// setLocation(). Gameplay reads them every frame; scenery is built per location by World.
export let LOCATION: LocationDef = LOCATIONS.park
export let PARK: ParkBounds = LOCATION.bounds
export let ROUTE_DEFS: RouteDef[] = LOCATION.routes
export let ROUTES: Route[] = ROUTE_DEFS.map(def => new Route(def))
export let TREES: TreeDef[] = planTrees()
export let FURNITURE: Furniture[] = planFurniture()

const cache = new Map<LocationId, { routes: Route[]; trees: TreeDef[]; furniture: Furniture[] }>()
cache.set('park', { routes: ROUTES, trees: TREES, furniture: FURNITURE })

export function setLocation(id: LocationId): LocationDef {
  LOCATION = LOCATIONS[id]
  PARK = LOCATION.bounds
  ROUTE_DEFS = LOCATION.routes
  let c = cache.get(id)
  if (!c) {
    ROUTES = ROUTE_DEFS.map(def => new Route(def))
    c = { routes: ROUTES, trees: planTrees(), furniture: [] }
    TREES = c.trees
    c.furniture = planFurniture()
    cache.set(id, c)
  }
  ROUTES = c.routes
  TREES = c.trees
  FURNITURE = c.furniture
  return LOCATION
}
