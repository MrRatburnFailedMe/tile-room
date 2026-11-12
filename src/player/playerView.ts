import * as THREE from 'three';
import type { CameraConfig } from '../config';
import type { PlayerController } from './playerController';

const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

/**
 * Places the camera at the player's eye and layers the feel effects on top:
 * speed FOV kick, head-bob (ground only, off while sliding) and a landing dip.
 * Runs every rendered frame and interpolates between physics ticks.
 */
export class PlayerView {
  private eyeHeight: number;
  private fov: number;
  private bobPhase = 0;
  private bobWeight = 0;
  private dip = 0;
  private dipVel = 0;

  /** Camera roll in radians (slide tilt / wall-run lean). Applied by the camera rig. */
  roll = 0;
  /** 0..1 strength of the speed-lines + vignette effect. */
  speedFx = 0;

  constructor(
    private readonly player: PlayerController,
    private readonly cfg: CameraConfig,
    private readonly sprintSpeed: number,
  ) {
    this.eyeHeight = cfg.eyeHeight;
    this.fov = cfg.baseFov;
  }

  /** `alpha` is how far the frame sits between the last two physics ticks; `yaw` is the view yaw. */
  update(dt: number, alpha: number, yaw: number, camera: THREE.PerspectiveCamera): void {
    const { player: p, cfg } = this;
    const speed = p.horizontalSpeed;

    // Eye height follows crouch smoothly.
    const eyeTarget = p.crouched ? cfg.crouchEyeHeight : cfg.eyeHeight;
    this.eyeHeight += (eyeTarget - this.eyeHeight) * damp(cfg.eyeLerp, dt);

    // Head-bob: distance-driven so it matches stride, faded out in the air and while sliding.
    const bobTarget = p.grounded && !p.sliding && speed > 0.5 ? Math.min(speed / this.sprintSpeed, 1.2) : 0;
    this.bobWeight += (bobTarget - this.bobWeight) * damp(cfg.bob.fade, dt);
    this.bobPhase = (this.bobPhase + speed * dt * cfg.bob.frequency) % (Math.PI * 2);
    const bobY = Math.sin(this.bobPhase * 2) * cfg.bob.vertical * this.bobWeight;
    const bobX = Math.cos(this.bobPhase) * cfg.bob.lateral * this.bobWeight;

    // Landing dip: a damped spring kicked downward by the impact speed.
    if (p.landingImpact > 0) {
      if (p.landingImpact >= cfg.landing.minImpact) {
        this.dipVel -= Math.min(p.landingImpact * cfg.landing.kick, cfg.landing.maxKick);
      }
      p.landingImpact = 0;
    }
    const h = Math.min(dt, 1 / 30);
    this.dipVel += (-cfg.landing.stiffness * this.dip - cfg.landing.damping * this.dipVel) * h;
    this.dip += this.dipVel * h;

    // FOV kick with speed.
    const t = THREE.MathUtils.clamp((speed - cfg.fovSpeedMin) / (cfg.fovSpeedMax - cfg.fovSpeedMin), 0, 1);
    this.fov += (cfg.baseFov + (cfg.maxFov - cfg.baseFov) * t - this.fov) * damp(cfg.fovLerp, dt);
    this.applyFov(camera, this.fov);

    // Roll: lean away from the wall while wall-running, slight tilt while sliding, ease back otherwise.
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    let rollTarget = 0;
    if (p.wallRunning) {
      const wallOnRight = -(p.wallNormal.x * rightX + p.wallNormal.z * rightZ) > 0;
      rollTarget = THREE.MathUtils.degToRad(cfg.wallRunRoll) * (wallOnRight ? 1 : -1);
    } else if (p.sliding) {
      rollTarget = THREE.MathUtils.degToRad(cfg.slideRoll);
    }
    this.roll += (rollTarget - this.roll) * damp(cfg.rollLerp, dt);

    const fx = THREE.MathUtils.clamp((speed - cfg.speedFx.min) / (cfg.speedFx.max - cfg.speedFx.min), 0, 1);
    this.speedFx += (fx - this.speedFx) * damp(cfg.speedFx.lerp, dt);

    const a = p.prevFeet;
    const b = p.feet;
    camera.position.set(
      a.x + (b.x - a.x) * alpha + rightX * bobX,
      a.y + (b.y - a.y) * alpha + this.eyeHeight + bobY + this.dip,
      a.z + (b.z - a.z) * alpha + rightZ * bobX,
    );
  }

  /** Used by free-fly so the debug camera isn't affected by player speed. */
  resetFov(camera: THREE.PerspectiveCamera): void {
    this.fov = this.cfg.baseFov;
    this.applyFov(camera, this.fov);
  }

  private applyFov(camera: THREE.PerspectiveCamera, fov: number): void {
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }
}
