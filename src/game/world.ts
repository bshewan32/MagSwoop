import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { CONFIG } from './config'
import type { Obstacles } from './bird'
import { FURNITURE, LOCATION, NEST_TREE, PARK, PERCHES, ROUTES, TREES, pathClearance, rng, type LocationDef, type TreeDef } from './park'

/**
 * Procedural suburban park in spring swooping season. Static scenery is baked into a few merged
 * vertex-coloured meshes (cheap draw calls); the nest eggs and nest-zone ring stay separate
 * because gameplay changes them.
 */
export const PALETTE = {
  skyTop: new THREE.Color('#3f86df'),
  horizon: new THREE.Color('#d4e8f0'),
  grass: ['#7fae4f', '#73a447', '#88b457', '#6c9a42'],
  dryGrass: '#b5ad66',
  bark: ['#ddd5c4', '#cbbd9f', '#b8a789', '#e8e1d2'],
  barkDark: '#8f7c63',
  leaves: ['#6f8a4a', '#829c55', '#5f7b43', '#93a868', '#7d9268'],
  asphalt: '#5a6069',
  gravel: '#c9a777',
  concrete: '#bdb6aa',
  boardwalk: '#a9825a',
  sandPath: '#d6bf8e',
  sand: '#ecd9a8',
  wetSand: '#cdb487',
  water: '#2b8db3',
  pine: ['#2f5d3a', '#356843', '#29523a'],
}

type Paint = string | ((x: number, y: number, z: number) => string)

/** Collects primitives with baked colours and transforms, then merges them into one mesh. */
class Batch {
  private parts: THREE.BufferGeometry[] = []
  add(geometry: THREE.BufferGeometry, color: Paint, matrix?: THREE.Matrix4): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry
    g.deleteAttribute('uv')
    if (matrix) g.applyMatrix4(matrix)
    const pos = g.attributes.position
    const colors = new Float32Array(pos.count * 3)
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i += 3) {
      const hex = typeof color === 'string' ? color
        : color((pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3, (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3)
      c.set(hex)
      for (let k = 0; k < 3; k += 1) c.toArray(colors, (i + k) * 3)
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    if (!g.attributes.normal) g.computeVertexNormals()
    this.parts.push(g)
  }
  build(material: THREE.Material, shadows = true): THREE.Mesh {
    const merged = mergeGeometries(this.parts, false)!
    for (const p of this.parts) p.dispose()
    this.parts = []
    const mesh = new THREE.Mesh(merged, material)
    mesh.castShadow = shadows
    mesh.receiveShadow = true
    return mesh
  }
}

const M = new THREE.Matrix4()
const Q = new THREE.Quaternion()
const V = new THREE.Vector3()
const S = new THREE.Vector3()
const E = new THREE.Euler()
function trs(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  return M.compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S.set(sx, sy, sz)).clone()
}

/** Cylinder from a to b. */
function limbMatrix(a: THREE.Vector3, b: THREE.Vector3): THREE.Matrix4 {
  const mid = a.clone().add(b).multiplyScalar(0.5)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
  return new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1))
}

const hash = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453
  return s - Math.floor(s)
}

export class World {
  readonly scene = new THREE.Scene()
  readonly sun: THREE.DirectionalLight
  readonly obstacles: Obstacles = { trunks: [], blobs: [] }
  /** Eggs in the nest, hidden one by one as they are lost. */
  readonly eggs: THREE.Mesh[] = []
  readonly nestPosition = new THREE.Vector3(PARK.nest.x, PARK.nestHeight, PARK.nest.z)
  private ring: THREE.Mesh
  private ringMat: THREE.MeshBasicMaterial
  private clouds: THREE.Object3D[] = []
  private alert = 0
  private time = 0
  private water: THREE.Mesh | null = null
  readonly location: LocationDef
  private readonly beach: boolean

  constructor(shadowMapSize: number, lowDetail = false, location: LocationDef = LOCATION) {
    this.location = location
    this.beach = location.id === 'beach'
    this.scene.background = PALETTE.horizon.clone()
    this.scene.fog = new THREE.Fog(PALETTE.horizon, 70, 240)
    this.scene.add(this.makeSky())
    this.scene.add(new THREE.HemisphereLight('#d6ecff', '#6d7f4a', 1.15))
    this.sun = new THREE.DirectionalLight('#fff1d6', 2.5)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize)
    const cam = this.sun.shadow.camera
    cam.left = cam.bottom = -38
    cam.right = cam.top = 38
    cam.near = 1
    cam.far = 160
    this.sun.shadow.bias = -0.0005
    this.sun.shadow.normalBias = 0.04
    this.scene.add(this.sun, this.sun.target)

    const solid = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 })
    this.scene.add(this.makeGround())
    this.scene.add(this.makePaths())

    const trunks = new Batch()
    const leaves = new Batch()
    const random = rng(31)
    for (const [i, t] of TREES.entries()) {
      if (this.beach && i % 2 === 0) this.norfolkPine(t, trunks, leaves, true)
      else this.gumTree(t, trunks, leaves, random, true)
    }
    this.nestTree(trunks, leaves)
    const outside = rng(57)
    for (let i = 0; i < (lowDetail ? 26 : 48); i += 1) {
      const a = outside() * Math.PI * 2
      const r = 92 + outside() * 50
      if (this.beach && Math.cos(a) * r > -12) {
        if (i % 3 === 0) this.norfolkPine({ x: -20 - outside() * 10, z: Math.sin(a) * r, height: 14, trunk: 0.4, crown: 3, lean: 0, seed: i }, trunks, leaves, false)
        continue
      }
      this.gumTree({ x: Math.cos(a) * r, z: Math.sin(a) * r, height: 8 + outside() * 6, trunk: 0.4, crown: 3.5 + outside() * 2, lean: 0, seed: i }, trunks, leaves, outside, false)
    }
    this.scene.add(trunks.build(solid))
    this.scene.add(leaves.build(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 })))

    const props = new Batch()
    this.fence(props)
    this.furniture(props)
    this.houses(props)
    if (this.beach) this.beachProps(props)
    this.scene.add(props.build(solid))
    if (this.beach) this.makeWater()

    this.scene.add(this.makeNest())
    this.ringMat = new THREE.MeshBasicMaterial({ color: '#fff7e0', transparent: true, opacity: 0.32, depthWrite: false })
    this.ring = new THREE.Mesh(new THREE.RingGeometry(CONFIG.run.nestRadius - 0.35, CONFIG.run.nestRadius, 96), this.ringMat)
    this.ring.rotation.x = -Math.PI / 2
    this.ring.position.set(PARK.nest.x, 0.06, PARK.nest.z)
    this.scene.add(this.ring)
    if (!lowDetail) this.scene.add(this.makeTufts())
    this.makeClouds()
  }

  private makeSky(): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(420, 32, 16)
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: PALETTE.skyTop }, horizon: { value: PALETTE.horizon } },
      vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vDir; void main() { float h = normalize(vDir).y; vec3 c = mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.5)); gl_FragColor = vec4(c, 1.0); }',
    })
    return new THREE.Mesh(geometry, material)
  }

  private makeGround(): THREE.Mesh {
    const g = new THREE.PlaneGeometry(520, 520, 130, 130)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position
    const colors = new Float32Array(pos.count * 3)
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const r = Math.hypot(x, z)
      const n = hash(Math.floor(x / 6), 0, Math.floor(z / 6))
      const n2 = Math.sin(x * 0.07) * Math.cos(z * 0.05) + Math.sin((x + z) * 0.031)
      if (this.beach && x > (this.location.sandX ?? 0) + Math.sin(z * 0.08) * 2) {
        // Sand slopes gently down into the surf; the sea floor stays flat to the horizon.
        const wx = this.location.waterX ?? 52
        const y = x < wx ? -((x - (this.location.sandX ?? 22)) / (wx - (this.location.sandX ?? 22))) * 0.35 : -0.35 - Math.min(1.2, (x - wx) * 0.05)
        pos.setY(i, y)
        c.set(x > wx - 5 ? PALETTE.wetSand : PALETTE.sand).offsetHSL(0, 0, (n - 0.5) * 0.04)
        c.toArray(colors, i * 3)
        continue
      }
      if (r > 160) pos.setY(i, (r - 160) * 0.28 + Math.sin(x * 0.05) * Math.cos(z * 0.04) * 6)
      if (r < PARK.fence) c.set(n2 > 1.1 ? PALETTE.dryGrass : PALETTE.grass[Math.floor(n * 4)])
      else if (r < 80) c.set('#8fb35a')
      else c.set(r > 160 ? '#7e9a62' : PALETTE.grass[Math.floor(n * 4)]).offsetHSL(0, -0.05, 0.02)
      c.toArray(colors, i * 3)
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    g.computeVertexNormals()
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }))
    mesh.receiveShadow = true
    return mesh
  }

  private makePaths(): THREE.Group {
    const group = new THREE.Group()
    const ribbon = (pts: { x: number; z: number }[], width: number, y: number, color: string, dashed = false) => {
      const positions: number[] = []
      for (let i = 0; i < pts.length - 1; i += 1) {
        if (dashed && i % 4 >= 2) continue
        const a = pts[i]
        const b = pts[i + 1]
        const dx = b.x - a.x
        const dz = b.z - a.z
        const len = Math.hypot(dx, dz) || 1
        const nx = (-dz / len) * width * 0.5
        const nz = (dx / len) * width * 0.5
        positions.push(a.x + nx, y, a.z + nz, b.x + nx, y, b.z + nz, b.x - nx, y, b.z - nz)
        positions.push(a.x + nx, y, a.z + nz, b.x - nx, y, b.z - nz, a.x - nx, y, a.z - nz)
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      g.computeVertexNormals()
      // Normals point up regardless of winding.
      const nrm = g.attributes.normal
      for (let i = 0; i < nrm.count; i += 1) nrm.setXYZ(i, 0, 1, 0)
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 - y * 10 }))
      mesh.receiveShadow = true
      group.add(mesh)
    }
    // Suburban road ring outside the fence (the beach has a straight coast road instead).
    const road = new THREE.Mesh(this.beach ? new THREE.PlaneGeometry(8, 300) : new THREE.RingGeometry(80, 87, 160), new THREE.MeshStandardMaterial({ color: '#4b5059', roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 }))
    road.rotation.x = -Math.PI / 2
    road.position.y = 0.02
    if (this.beach) road.position.x = -44
    road.receiveShadow = true
    group.add(road)
    for (const route of ROUTES) {
      const sf = route.def.surface
      const color = sf === 'asphalt' ? PALETTE.asphalt : sf === 'gravel' ? PALETTE.gravel : sf === 'boardwalk' ? PALETTE.boardwalk : sf === 'sand' ? PALETTE.sandPath : PALETTE.concrete
      if (sf === 'sand') {
        ribbon(route.pts, route.def.width, 0.02, color)
        continue
      }
      ribbon(route.pts, route.def.width + 0.5, 0.03, '#a59c80')
      ribbon(route.pts, route.def.width, 0.05, color)
      if (route.def.surface === 'asphalt') ribbon(route.pts, 0.14, 0.07, '#f2efe6', true)
    }
    return group
  }

  private gumTree(t: TreeDef, trunks: Batch, leaves: Batch, random: () => number, collide: boolean): void {
    const h0 = t.height * 0.55
    const barkPaint = (x: number, y: number, z: number) => {
      const n = hash(Math.round(x * 3), Math.round(y * 2), Math.round(z * 3))
      return n > 0.82 ? PALETTE.barkDark : PALETTE.bark[Math.floor(n * 3.9)]
    }
    const top = new THREE.Vector3(t.x + Math.sin(t.lean) * h0, h0, t.z)
    trunks.add(new THREE.CylinderGeometry(t.trunk * 0.6, t.trunk * 1.15, h0, 7, 3), barkPaint, limbMatrix(new THREE.Vector3(t.x, 0, t.z), top))
    if (collide) this.obstacles.trunks.push({ x: t.x, z: t.z, r: t.trunk * 1.1, top: h0 + 0.5 })
    const limbs = 3 + Math.floor(random() * 2)
    for (let i = 0; i < limbs; i += 1) {
      const a = (i / limbs) * Math.PI * 2 + random() * 0.8
      const out = t.crown * (0.55 + random() * 0.35)
      const tip = new THREE.Vector3(top.x + Math.cos(a) * out, h0 + t.height * (0.28 + random() * 0.2), top.z + Math.sin(a) * out)
      trunks.add(new THREE.CylinderGeometry(t.trunk * 0.22, t.trunk * 0.45, top.distanceTo(tip), 5), barkPaint, limbMatrix(top, tip))
      this.canopy(tip.x, tip.y + 0.6, tip.z, t.crown * (0.5 + random() * 0.25), leaves, random, collide)
    }
    this.canopy(top.x, t.height, top.z, t.crown * 0.6, leaves, random, collide)
  }

  private canopy(x: number, y: number, z: number, r: number, leaves: Batch, random: () => number, collide: boolean): void {
    const colour = PALETTE.leaves[Math.floor(random() * PALETTE.leaves.length)]
    const leafPaint = (px: number, py: number, pz: number) => (hash(px * 2, py * 2, pz * 2) > 0.7 ? PALETTE.leaves[Math.floor(hash(px, py, pz) * 5)] : colour)
    leaves.add(new THREE.IcosahedronGeometry(r, 1), leafPaint, trs(x, y, z, random(), random(), 0, 1, 0.62, 1))
    for (let i = 0; i < 2; i += 1) {
      const a = random() * Math.PI * 2
      leaves.add(new THREE.IcosahedronGeometry(r * 0.6, 0), leafPaint, trs(x + Math.cos(a) * r * 0.75, y - r * 0.15, z + Math.sin(a) * r * 0.75, random(), random(), 0, 1, 0.7, 1))
    }
    if (collide) this.obstacles.blobs.push({ x, y, z, r: r * 0.8 })
  }

  private nestTree(trunks: Batch, leaves: Batch): void {
    const t = NEST_TREE
    const h0 = PARK.nestHeight - 0.2
    const random = rng(t.seed)
    const barkPaint = (x: number, y: number, z: number) => {
      const n = hash(Math.round(x * 3), Math.round(y * 2), Math.round(z * 3))
      return n > 0.82 ? PALETTE.barkDark : PALETTE.bark[Math.floor(n * 3.9)]
    }
    const base = new THREE.Vector3(t.x, 0, t.z)
    const top = new THREE.Vector3(t.x, h0, t.z)
    trunks.add(new THREE.CylinderGeometry(t.trunk * 0.7, t.trunk * 1.3, h0, 9, 4), barkPaint, limbMatrix(base, top))
    this.obstacles.trunks.push({ x: t.x, z: t.z, r: t.trunk * 1.2, top: h0 })
    // One limb out to each perch, with a leafy crown above and beyond it.
    for (const p of PERCHES) {
      const tip = new THREE.Vector3(p.x, p.y - 0.42, p.z)
      trunks.add(new THREE.CylinderGeometry(0.1, 0.24, top.distanceTo(tip), 6), barkPaint, limbMatrix(top, tip))
      const out = new THREE.Vector3(p.x - t.x, 0, p.z - t.z).normalize()
      this.canopy(p.x + out.x * 2.2, p.y + 2.2, p.z + out.z * 2.2, 2.5, leaves, random, true)
    }
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * Math.PI * 2 + 0.9
      const tip = new THREE.Vector3(t.x + Math.cos(a) * 3.4, h0 + 3.4, t.z + Math.sin(a) * 3.4)
      trunks.add(new THREE.CylinderGeometry(0.1, 0.22, top.distanceTo(tip), 6), barkPaint, limbMatrix(top, tip))
      this.canopy(tip.x, tip.y + 0.8, tip.z, 2.8, leaves, random, true)
    }
    this.canopy(t.x, h0 + 5, t.z, 3.2, leaves, random, true)
  }

  /** Tall tiered Norfolk Island pine, the classic beachfront tree. */
  private norfolkPine(t: TreeDef, trunks: Batch, leaves: Batch, collide: boolean): void {
    const h = t.height * 1.35
    trunks.add(new THREE.CylinderGeometry(t.trunk * 0.35, t.trunk, h, 6), '#6b5440', limbMatrix(new THREE.Vector3(t.x, 0, t.z), new THREE.Vector3(t.x, h, t.z)))
    if (collide) this.obstacles.trunks.push({ x: t.x, z: t.z, r: t.trunk, top: h })
    const tiers = 6
    for (let i = 0; i < tiers; i += 1) {
      const y = h * (0.35 + (i / tiers) * 0.62)
      const r = t.crown * (1.05 - i / tiers * 0.8)
      leaves.add(new THREE.ConeGeometry(r, 1.6, 7), PALETTE.pine[i % 3], trs(t.x, y, t.z, 0, i * 0.7, 0))
      if (collide) this.obstacles.blobs.push({ x: t.x, y, z: t.z, r: r * 0.7 })
    }
  }

  private beachProps(props: Batch): void {
    // Surf life saving club on the sand, with the red-and-yellow patrol flags below it.
    props.add(new THREE.BoxGeometry(7, 4.2, 12), '#efe6d2', trs(46, 2.1, -32))
    props.add(new THREE.BoxGeometry(7.6, 0.4, 12.6), '#c8342b', trs(46, 4.4, -32))
    props.add(new THREE.BoxGeometry(0.1, 1.6, 9), '#5b7a99', trs(42.45, 2.4, -32))
    this.obstacles.trunks.push({ x: 46, z: -32, r: 6, top: 4.6 })
    for (const z of [-6, 14]) {
      props.add(new THREE.CylinderGeometry(0.05, 0.05, 3, 5), '#d9d9d9', trs(47, 1.4, z))
      props.add(new THREE.BoxGeometry(0.04, 0.8, 1.2), '#e2231a', trs(47, 2.5, z + 0.6))
      props.add(new THREE.BoxGeometry(0.04, 0.4, 1.2), '#ffd400', trs(47.01, 2.3, z + 0.6))
    }
    // Pastel beach huts along the top of the sand.
    const huts = ['#ff8fa3', '#7fd1e8', '#ffd166', '#9be15d', '#c3a6ff', '#ffffff']
    for (let i = 0; i < 6; i += 1) {
      const z = 58 + i * 4.2
      props.add(new THREE.BoxGeometry(3, 2.6, 3.2), huts[i], trs(25, 1.3, z))
      const roof = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1)
      roof.rotateY(Math.PI / 4)
      props.add(roof, '#f4f1ea', trs(25, 3.1, z, 0, 0, 0, 3.4, 1.2, 3.6))
      this.obstacles.trunks.push({ x: 25, z, r: 1.8, top: 3.6 })
    }
    // Umbrellas and towels dotted along the sand.
    const random = rng(4040)
    for (let i = 0; i < 14; i += 1) {
      const x = 40 + random() * 9
      const z = -70 + random() * 140
      if (Math.abs(z + 32) < 9) continue
      const col = huts[Math.floor(random() * huts.length)]
      props.add(new THREE.CylinderGeometry(0.03, 0.03, 2.1, 4), '#eeeeee', trs(x, 0.9, z, 0.1, 0, 0.1))
      props.add(new THREE.ConeGeometry(1.2, 0.5, 8), col, trs(x + 0.1, 2, z + 0.1))
      props.add(new THREE.BoxGeometry(0.9, 0.02, 1.8), huts[(i + 2) % huts.length], trs(x + 1.4, 0.0, z, 0, random(), 0))
    }
  }

  private makeWater(): void {
    const g = new THREE.PlaneGeometry(380, 520, 48, 64)
    g.rotateX(-Math.PI / 2)
    const material = new THREE.MeshStandardMaterial({ color: PALETTE.water, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.88, flatShading: true })
    this.water = new THREE.Mesh(g, material)
    this.water.position.set((this.location.waterX ?? 52) + 190, -0.12, 0)
    this.water.receiveShadow = true
    this.scene.add(this.water)
    // A line of white surf just off the beach.
    const foam = new THREE.Mesh(new THREE.PlaneGeometry(3, 520).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 }))
    foam.position.set((this.location.waterX ?? 52) + 1.5, -0.08, 0)
    this.scene.add(foam)
  }

  private makeNest(): THREE.Group {
    const group = new THREE.Group()
    group.position.copy(this.nestPosition)
    const sticks = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.24, 6, 12), new THREE.MeshStandardMaterial({ color: '#6e4b2c', flatShading: true, roughness: 1 }))
    sticks.rotation.x = Math.PI / 2
    sticks.scale.set(1, 1, 0.7)
    sticks.castShadow = true
    const lining = new THREE.Mesh(new THREE.CircleGeometry(0.5, 12), new THREE.MeshStandardMaterial({ color: '#4a3220', roughness: 1 }))
    lining.rotation.x = -Math.PI / 2
    lining.position.y = -0.05
    group.add(sticks, lining)
    const eggMat = new THREE.MeshStandardMaterial({ color: '#9cc9b6', roughness: 0.5, flatShading: true })
    for (let i = 0; i < CONFIG.run.eggs; i += 1) {
      const a = (i / CONFIG.run.eggs) * Math.PI * 2
      const egg = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 1), eggMat)
      egg.scale.set(1, 1.3, 1)
      egg.position.set(Math.cos(a) * 0.2, 0.08, Math.sin(a) * 0.2)
      egg.rotation.set(0.6, a, 0.3)
      group.add(egg)
      this.eggs.push(egg)
    }
    return group
  }

  private fence(props: Batch): void {
    const R = PARK.fence
    // Gaps where paths pass through the fence.
    const gaps: number[] = []
    for (const route of ROUTES) {
      for (const p of route.pts) {
        if (Math.abs(Math.hypot(p.x, p.z) - R) < 0.6) gaps.push(Math.atan2(p.z, p.x))
      }
    }
    const inGap = (a: number) => gaps.some(g => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) * R < 3.2)
    const step = 3 / R
    for (let a = 0; a < Math.PI * 2; a += step) {
      if (inGap(a)) continue
      if (this.beach && Math.cos(a) * R > 18) continue
      const x = Math.cos(a) * R
      const z = Math.sin(a) * R
      props.add(new THREE.BoxGeometry(0.16, 1.1, 0.16), '#86664a', trs(x, 0.55, z, 0, -a))
      if (inGap(a + step)) continue
      const mx = Math.cos(a + step / 2) * R
      const mz = Math.sin(a + step / 2) * R
      for (const y of [0.45, 0.9]) props.add(new THREE.BoxGeometry(0.08, 0.1, 3.05), '#9b7a58', trs(mx, y, mz, 0, -a - step / 2))
    }
  }

  private furniture(props: Batch): void {
    for (const f of FURNITURE) {
      if (f.kind === 'bench') {
        const at = (dx: number, y: number, dz: number) => {
          const c = Math.cos(f.yaw)
          const s = Math.sin(f.yaw)
          return [f.x + dx * c + dz * s, y, f.z - dx * s + dz * c] as const
        }
        const [x, , z] = at(0, 0, 0)
        props.add(new THREE.BoxGeometry(1.7, 0.08, 0.45), '#a5713f', trs(x, 0.46, z, 0, f.yaw))
        const [bx, , bz] = at(0, 0, -0.22)
        props.add(new THREE.BoxGeometry(1.7, 0.32, 0.06), '#99683a', trs(bx, 0.76, bz, -0.2, f.yaw))
        for (const side of [-0.7, 0.7]) {
          const [lx, , lz] = at(side, 0, 0)
          props.add(new THREE.BoxGeometry(0.08, 0.46, 0.45), '#3b3f46', trs(lx, 0.23, lz, 0, f.yaw))
        }
      } else if (f.kind === 'lamp') {
        props.add(new THREE.CylinderGeometry(0.06, 0.09, 4.2, 6), '#3e444d', trs(f.x, 2.1, f.z))
        props.add(new THREE.BoxGeometry(0.5, 0.18, 0.3), '#30353c', trs(f.x, 4.25, f.z, 0, f.yaw))
        this.obstacles.trunks.push({ x: f.x, z: f.z, r: 0.1, top: 4.4 })
      } else {
        props.add(new THREE.BoxGeometry(0.55, 0.9, 0.6), '#2f6b3c', trs(f.x, 0.45, f.z, 0, f.yaw))
        props.add(new THREE.BoxGeometry(0.6, 0.06, 0.66), '#c33d2c', trs(f.x, 0.93, f.z, 0, f.yaw))
      }
    }
  }

  private houses(props: Batch): void {
    const random = rng(808)
    const walls = ['#cdb79c', '#e9dfc8', '#b5674a', '#d9d3c5', '#a9b9ae', '#c78f6a']
    const roofs = ['#a94e2c', '#596069', '#3f4b58', '#8f3d2b', '#6d737b']
    for (const ring of [100, 124]) {
      const count = Math.floor((Math.PI * 2 * ring) / 15)
      for (let i = 0; i < count; i += 1) {
        const a = (i / count) * Math.PI * 2 + random() * 0.05 + (ring === 124 ? 0.1 : 0)
        const r = ring + random() * 5
        const x = Math.cos(a) * r
        const z = Math.sin(a) * r
        if (this.beach && x > -50) continue
        const w = 9 + random() * 3
        const d = 8 + random() * 3
        const h = 2.8 + (random() < 0.2 ? 2.6 : 0)
        const yaw = -a + Math.PI / 2
        props.add(new THREE.BoxGeometry(w, h, d), walls[Math.floor(random() * walls.length)], trs(x, h / 2, z, 0, yaw))
        const roof = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1)
        roof.rotateY(Math.PI / 4)
        props.add(roof, roofs[Math.floor(random() * roofs.length)], trs(x, h + 1.1, z, 0, yaw, 0, w * 1.08, 2.2, d * 1.08))
        if (random() < 0.6) props.add(new THREE.BoxGeometry(1.2, 1.5, 0.06), '#5b7a99', trs(x + Math.cos(a) * -d * 0.51, 1.4, z + Math.sin(a) * -d * 0.51, 0, yaw))
      }
    }
  }

  private makeTufts(): THREE.InstancedMesh {
    const random = rng(5150)
    const count = 1600
    const mesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.09, 0.4, 3), new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1 }), count)
    const flowerColor = new THREE.Color('#f2cf2b')
    const grassColor = new THREE.Color('#6e9d43')
    let n = 0
    while (n < count) {
      const a = random() * Math.PI * 2
      const r = Math.sqrt(random()) * (PARK.fence - 1)
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      if (pathClearance(x, z) < 0.4) continue
      if (this.beach && x > (this.location.sandX ?? 22) - 2) continue
      const flower = random() < 0.18
      mesh.setMatrixAt(n, trs(x, flower ? 0.1 : 0.2, z, 0, random() * 3, 0, flower ? 1.2 : 1, flower ? 0.4 : 0.7 + random() * 0.8, flower ? 1.2 : 1))
      mesh.setColorAt(n, flower ? flowerColor : grassColor)
      n += 1
    }
    mesh.receiveShadow = true
    return mesh
  }

  private makeClouds(): void {
    const random = rng(99)
    const material = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1, emissive: '#dfe9f2', emissiveIntensity: 0.35, fog: false })
    for (let i = 0; i < 10; i += 1) {
      const parts: THREE.BufferGeometry[] = []
      for (let k = 0; k < 5; k += 1) {
        const g = new THREE.IcosahedronGeometry(4 + random() * 4, 0)
        g.translate((k - 2) * 5 + random() * 2, random() * 2, random() * 4)
        parts.push(g)
      }
      const cloud = new THREE.Mesh(mergeGeometries(parts), material)
      const a = random() * Math.PI * 2
      const r = 80 + random() * 160
      cloud.position.set(Math.cos(a) * r, 70 + random() * 30, Math.sin(a) * r)
      cloud.scale.y = 0.55
      this.scene.add(cloud)
      this.clouds.push(cloud)
    }
  }

  setEggs(count: number): void {
    this.eggs.forEach((egg, i) => (egg.visible = i < count))
  }

  /** 0 = calm, 1 = an intruder is inside the nest zone. */
  setNestAlert(level: number): void {
    this.alert = level
  }

  /** Keep the shadow camera on the action, drift clouds, pulse the nest ring. */
  update(focus: THREE.Vector3, dt: number): void {
    this.time += dt
    this.sun.position.set(focus.x + 34, 58, focus.z + 22)
    this.sun.target.position.set(focus.x, 0, focus.z)
    for (const c of this.clouds) {
      c.position.x += dt * 1.2
      if (c.position.x > 260) c.position.x = -260
    }
    if (this.water) {
      const pos = this.water.geometry.attributes.position
      for (let i = 0; i < pos.count; i += 1) pos.setY(i, Math.sin(pos.getX(i) * 0.15 + this.time * 1.4) * 0.12 + Math.cos(pos.getZ(i) * 0.1 + this.time) * 0.08)
      pos.needsUpdate = true
      this.water.geometry.computeVertexNormals()
    }
    const pulse = this.alert > 0 ? 0.45 + 0.35 * Math.sin(this.time * 8) : 0.3
    this.ringMat.opacity = pulse
    this.ringMat.color.set(this.alert > 0 ? '#ff4d4d' : '#fff7e0')
    this.ring.scale.setScalar(1 + (this.alert > 0 ? Math.sin(this.time * 8) * 0.01 : 0))
  }
}
