import * as THREE from 'three';
import { config } from '../config';
import type { Input } from '../input';

const PITCH_LIMIT = Math.PI / 2 - 0.01;
const FLY_SPEED = 8; // m/s
const FLY_BOOST = 4;

/**
 * Pointer-lock mouse look, plus the debug free-fly camera.
 * In normal play the camera position comes from PlayerView; this only owns orientation.
 */
export class CameraRig {
  yaw = 0;
  pitch = 0;
  /** Extra roll in radians, set by the player view (0 in free-fly). */
  roll = 0;
  flyEnabled = false;

  /** Mouse movement in pixels since the last consumeLookDelta(), for viewmodel sway. */
  private lookDX = 0;
  private lookDY = 0;
  /** Recoil offsets (radians) that ease back to zero on their own. */
  private recoilPitch = 0;
  private recoilYaw = 0;
  /** Shake "trauma" 0..1; the visible shake is its square. */
  private trauma = 0;

  private readonly move = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    private readonly input: Input,
  ) {
    canvas.addEventListener('click', () => {
      if (document.pointerLockElement !== canvas) {
        // Returns a promise in modern browsers; rejection (e.g. re-lock cooldown) is harmless.
        Promise.resolve(canvas.requestPointerLock()).catch(() => {});
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const s = config.look.sensitivity;
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
      this.yaw -= e.movementX * s;
      const dy = e.movementY * s * (config.look.invertY ? -1 : 1);
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy, -PITCH_LIMIT, PITCH_LIMIT);
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  toggleFly(): boolean {
    this.flyEnabled = !this.flyEnabled;
    return this.flyEnabled;
  }

  /** Kick the view (radians). Pitch is upward; both recover automatically. */
  recoil(pitch: number, yaw: number): void {
    this.recoilPitch = Math.min(this.recoilPitch + pitch, 0.35);
    this.recoilYaw += yaw;
  }

  addShake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  consumeLookDelta(out: { x: number; y: number }): void {
    out.x = this.lookDX;
    out.y = this.lookDY;
    this.lookDX = this.lookDY = 0;
  }

  /** Decay recoil and shake. Call once per frame. */
  update(dt: number): void {
    const k = Math.exp(-9 * dt);
    this.recoilPitch *= k;
    this.recoilYaw *= k;
    this.trauma = Math.max(0, this.trauma - 2.8 * dt);
  }

  /** Apply yaw/pitch/roll plus recoil and shake to the camera. Call every frame. */
  applyLook(): void {
    const s = this.trauma * this.trauma;
    const j = (): number => (Math.random() * 2 - 1) * s;
    this.euler.set(
      THREE.MathUtils.clamp(this.pitch + this.recoilPitch, -PITCH_LIMIT, PITCH_LIMIT) + j() * 0.012,
      this.yaw + this.recoilYaw + j() * 0.012,
      this.roll + j() * 0.02,
    );
    this.camera.quaternion.setFromEuler(this.euler);
  }

  /** Free-fly movement: WASD along the view, Space/E up, Q down, Shift boost. */
  updateFly(dt: number): void {
    const i = this.input;
    this.move.set(i.axis('KeyA', 'KeyD'), 0, i.axis('KeyW', 'KeyS'));
    const vertical = (i.down('Space') || i.down('KeyE') ? 1 : 0) - (i.down('KeyQ') ? 1 : 0);
    if (this.move.lengthSq() === 0 && vertical === 0) return;

    this.move.applyQuaternion(this.camera.quaternion);
    this.move.y += vertical;
    this.move.normalize();

    const boost = i.down('ShiftLeft') || i.down('ShiftRight') ? FLY_BOOST : 1;
    this.camera.position.addScaledVector(this.move, FLY_SPEED * boost * dt);
  }
}
