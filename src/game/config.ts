/**
 * All gameplay tuning in one place. Change numbers here before touching game code; tests read
 * the same values so rule changes stay covered. Units: metres, seconds, radians, m/s.
 */
export const DEFAULT_CONFIG = {
  run: {
    seconds: 150,
    /** Eggs in the nest; an intruder slipping past the nest unchallenged costs one. */
    eggs: 3,
    /** Radius around the nest tree that counts as the nest zone. */
    nestRadius: 13,
  },
  score: {
    scareRunner: 100,
    scareCyclist: 150,
    hitRunner: 250,
    hitCyclist: 350,
    scareSurfer: 120,
    hitSurfer: 300,
    scareScooter: 170,
    hitScooter: 380,
    /** Extra points for clearing an intruder out of the nest zone. */
    defendBonus: 100,
    /** Consecutive scares within `comboWindow` seconds raise the multiplier up to `comboMax`. */
    comboWindow: 4,
    comboMax: 5,
    /** Points multiplier while the territorial carol is ringing. */
    carolMultiplier: 1.5,
    eggBonus: 500,
    /** Score needed for the third star (the second needs every egg kept). */
    starScore: 6000,
  },
  flight: {
    cruiseSpeed: 11,
    boostSpeed: 18,
    tiredSpeed: 7.5,
    acceleration: 6,
    turnRate: 2.1,
    pitchRate: 1.5,
    maxPitch: 1.0,
    /** How far the bird rolls into a turn. */
    bank: 0.55,
    flapLift: 5.5,
    flapCost: 0.03,
    boostDrain: 0.2,
    regenFlying: 0.05,
    regenPerched: 0.28,
    minHeight: 0.8,
    maxHeight: 40,
    /** Radius of the patch the magpie defends; it is turned back past the edge. */
    territory: 72,
  },
  swoop: {
    speed: 25,
    duration: 1.2,
    cooldown: 0.45,
    cost: 0.16,
    lockRange: 40,
    /** Half-angle of the forward cone that can lock a target. */
    lockAngle: 0.65,
    homing: 6,
    hitRadius: 1.2,
    scareRadius: 3.4,
  },
  carol: {
    cooldown: 8,
    buffTime: 5,
    /** Scare radius multiplier while carolling. */
    scareBoost: 1.35,
  },
  people: {
    max: 8,
    maxLate: 13,
    spawnEvery: 2.6,
    spawnEveryLate: 1.3,
    runnerSpeed: 3.3,
    cyclistSpeed: 7,
    surferSpeed: 2.3,
    scooterSpeed: 8.2,
    fleeBoost: 1.9,
  },
  endless: {
    /** Seconds for the crowd to reach full late-season density; it keeps rising past that. */
    rampSeconds: 180,
    /** Crowd pressure keeps growing to this multiple of the late-season level. */
    maxPressure: 1.6,
    /** Every this many points the parents restock a lost egg (up to the full clutch). */
    restockEvery: 5000,
  },
  camera: {
    distance: 5.2,
    height: 1.5,
    follow: 7,
    fov: 70,
  },
} as const

// Gameplay always reads active values here. Source defaults remain immutable for
// Tweak Reset and Save with Manus; Apply never writes source or local storage.
type MutableConfig<T> = { -readonly [K in keyof T]: T[K] extends number ? number : T[K] extends object ? MutableConfig<T[K]> : T[K] }
export const CONFIG: MutableConfig<typeof DEFAULT_CONFIG> = structuredClone(DEFAULT_CONFIG)
