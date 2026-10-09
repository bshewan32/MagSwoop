import * as THREE from 'three'
import { CONFIG } from './config'
import { forwardOf } from './bird'

const C = CONFIG.camera

export type ChaseTarget = { position: THREE.Vector3; yaw: number; pitch: number; speed: number; swooping: boolean }

/**
 * Third-person chase camera behind the controlled magpie. Position eases toward a point behind
 * and above the bird; the field of view widens with speed and during swoops; switching birds is
 * a smooth glide because the camera simply starts chasing the new one.
 */
export class ChaseCamera {
  readonly camera = new THREE.PerspectiveCamera(C.fov, 1, 0.1, 700)
  private readonly look = new THREE.Vector3()
  private fov: number = C.fov
  private shake = 0
  private readonly tmp = new THREE.Vector3()
  private readonly want = new THREE.Vector3()

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount)
  }

  private desired(t: ChaseTarget, out: THREE.Vector3): THREE.Vector3 {
    const back = forwardOf(t.yaw, t.pitch * 0.55, this.tmp)
    const dist = C.distance * (t.swooping ? 0.85 : 1)
    out.copy(t.position).addScaledVector(back, -dist)
    out.y += C.height
    out.y = Math.max(out.y, 0.7)
    return out
  }

  /** Snap behind the target (run start). */
  reset(t: ChaseTarget): void {
    this.desired(t, this.camera.position)
    this.look.copy(t.position).addScaledVector(forwardOf(t.yaw, t.pitch, this.tmp), 3)
    this.camera.lookAt(this.look)
  }

  follow(t: ChaseTarget, frameSeconds: number, reducedMotion: boolean): void {
    const k = 1 - Math.exp(-C.follow * frameSeconds)
    this.desired(t, this.want)
    this.camera.position.lerp(this.want, k)
    this.camera.position.y = Math.max(this.camera.position.y, 0.6)
    this.tmp.copy(t.position).addScaledVector(forwardOf(t.yaw, t.pitch, this.want), 3)
    this.tmp.y += 0.35
    this.look.lerp(this.tmp, Math.min(1, k * 1.8))
    this.camera.lookAt(this.look)
    const kick = Math.max(0, t.speed - CONFIG.flight.cruiseSpeed) * 0.7 + (t.swooping ? 8 : 0)
    this.setFov(C.fov + (reducedMotion ? kick * 0.3 : kick), frameSeconds)
    this.applyShake(frameSeconds, reducedMotion)
  }

  /** Slow orbit around the nest tree for the title screen. */
  orbit(center: THREE.Vector3, time: number, frameSeconds: number): void {
    const a = time * 0.07
    this.camera.position.set(center.x + Math.cos(a) * 24, 11 + Math.sin(time * 0.15) * 2, center.z + Math.sin(a) * 24)
    this.look.set(center.x, 7.5, center.z)
    this.camera.lookAt(this.look)
    this.setFov(C.fov - 8, frameSeconds)
  }

  private setFov(target: number, frameSeconds: number): void {
    this.fov += (target - this.fov) * (1 - Math.exp(-4 * frameSeconds))
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov
      this.camera.updateProjectionMatrix()
    }
  }

  private applyShake(frameSeconds: number, reducedMotion: boolean): void {
    if (this.shake > 0 && !reducedMotion) {
      const s = this.shake * this.shake * 0.3
      this.camera.position.add(this.tmp.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s))
    }
    this.shake = Math.max(0, this.shake - frameSeconds * 2.5)
  }
}
