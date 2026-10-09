import { CONFIG, DEFAULT_CONFIG } from './config'

type Mode = 'LIVE' | 'NEXT_ACTION' | 'NEXT_RUN'
type Boundary = 'swoop' | 'run'
type Control = { id: string; type: 'number'; category: string; label: string; description: string; unit: string;
  default: number; min: number; max: number; step: number; applyMode: Mode; integrity: 'COSMETIC' | 'GAMEPLAY' }
type Binding = { control: Control; boundary?: Boundary; read(): number; write(value: number): void }
const bindings: Binding[] = []
const CATEGORY: Record<string, string> = { flight: 'Flight', swoop: 'Swoop', carol: 'Carol', camera: 'Camera', run: 'Run' }
function number<S extends keyof typeof CONFIG>(section: S, key: keyof typeof CONFIG[S] & string,
  label: string, min: number, max: number, step: number, unit: string, boundary?: Boundary): void {
  const values = CONFIG[section] as Record<string, number>
  const defaults = DEFAULT_CONFIG[section] as Record<string, number>
  bindings.push({ control: Object.freeze({ id: `${section}.${key}`, type: 'number', category: CATEGORY[section] ?? 'Run',
    label, description: boundary === 'swoop' ? 'Applies when the next swoop starts.' : boundary === 'run' ? 'Applies when a new run starts.' : 'Updates this preview immediately.',
    unit, default: defaults[key], min, max, step,
    applyMode: boundary === 'run' ? 'NEXT_RUN' : boundary ? 'NEXT_ACTION' : 'LIVE',
    integrity: section === 'camera' ? 'COSMETIC' : 'GAMEPLAY' }), boundary,
    read: () => values[key], write: value => { values[key] = value } })
}
number('flight', 'cruiseSpeed', 'Cruise speed', 4, 20, 0.5, 'm/s')
number('flight', 'boostSpeed', 'Boost speed', 6, 30, 0.5, 'm/s')
number('flight', 'turnRate', 'Turn rate', 0.5, 4, 0.1, 'rad/s')
number('flight', 'pitchRate', 'Climb/dive rate', 0.5, 3, 0.1, 'rad/s')
number('flight', 'boostDrain', 'Boost stamina drain', 0, 0.6, 0.02, '/s')
number('swoop', 'speed', 'Swoop speed', 10, 40, 1, 'm/s', 'swoop')
number('swoop', 'homing', 'Swoop homing', 1, 12, 0.5, '', 'swoop')
number('swoop', 'scareRadius', 'Scare radius', 1.5, 6, 0.1, 'm')
number('swoop', 'hitRadius', 'Hit radius', 0.5, 2.5, 0.05, 'm')
number('carol', 'buffTime', 'Carol buff time', 1, 10, 0.5, 's')
number('camera', 'fov', 'Field of view', 40, 100, 1, '°')
number('camera', 'distance', 'Camera distance', 2.5, 12, 0.1, 'm')
number('camera', 'follow', 'Camera follow speed', 2, 20, 1, '')
number('run', 'seconds', 'Season length', 30, 300, 10, 's', 'run')
number('run', 'eggs', 'Eggs in the nest', 1, 6, 1, '', 'run')
const byId = new Map(bindings.map(binding => [binding.control.id, binding]))
let requested = Object.fromEntries(bindings.map(({ control }) => [control.id, control.default]))
const valid = (values: Record<string, number>) => values['flight.cruiseSpeed'] <= values['flight.boostSpeed']

let unranked = false
const gameplayModified = () => bindings.some(binding => binding.control.integrity === 'GAMEPLAY' && binding.read() !== binding.control.default)

export const tuning = {
  get unranked(): boolean { return unranked },
  controls: Object.freeze(bindings.map(binding => binding.control)),
  read() {
    return { requested: { ...requested }, active: Object.fromEntries(bindings.map(binding => [binding.control.id, binding.read()])) }
  },
  apply(patch: unknown): void {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid patch')
    const entries = Object.entries(patch)
    if (entries.length > bindings.length) throw new Error('Invalid patch')
    for (const [id, value] of entries) {
      const control = byId.get(id)?.control
      if (!control || typeof value !== 'number' || !Number.isFinite(value) || value < control.min || value > control.max) throw new Error('Invalid value')
      const steps = (value - control.min) / control.step
      if (value !== control.default && Math.abs(steps - Math.round(steps)) > 1e-7) throw new Error('Invalid increment')
    }
    const candidate = { ...requested, ...patch } as Record<string, number>
    const nextActive = this.read().active
    for (const [id, value] of entries) if (byId.get(id)!.control.applyMode === 'LIVE') nextActive[id] = value
    if (!valid(candidate) || !valid(nextActive)) throw new Error('Cruise speed must not exceed boost speed')
    // All writes are simple assignments, synchronously committed before the next
    // physics/render callback. No engine callbacks run during this transaction.
    requested = candidate
    for (const [id, value] of entries) {
      const binding = byId.get(id)!
      if (binding.control.applyMode === 'LIVE') binding.write(value)
    }
    unranked ||= gameplayModified()
  },
  activate(boundary: Boundary): void {
    for (const binding of bindings) if (binding.boundary === boundary) binding.write(requested[binding.control.id])
    // Reset only at a new run; resetting values mid-run cannot restore eligibility.
    unranked = boundary === 'run' ? gameplayModified() : unranked || gameplayModified()
  },
}
