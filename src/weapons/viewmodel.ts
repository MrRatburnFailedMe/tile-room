import * as THREE from 'three';
import type { WeaponDef } from './weaponDefs';
import { buildWeaponModel } from './weaponModel';

const REST = new THREE.Vector3(0.19, -0.17, -0.55);
const SCALE = 0.62;
const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

/**
 * First-person weapon, drawn in its own scene with its own camera after the
 * world (with the depth buffer cleared in between), so it can never poke into
 * walls and keeps a fixed FOV while the world FOV kicks around.
 *
 * Motion is procedural: sway that lags the mouse, bob from walking, a
 * push-back from recoil and a raise when a gun is equipped.
 */
export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.01, 10);

  private readonly holder = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private readonly flash: THREE.Sprite;
  private flashT = 0;

  private swayX = 0;
  private swayY = 0;
  private bobPhase = 0;
  private bobWeight = 0;
  private kickZ = 0;
  private equip = 1;

  constructor() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8d95a3, 2.4));
    const key = new THREE.DirectionalLight(0xfff3e4, 1.6);
    key.position.set(1, 2, 1.5);
    this.holder.scale.setScalar(SCALE);
    this.scene.add(key, this.holder);

    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: makeFlashTexture(), blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true }),
    );
    this.flash.material.color.setRGB(3, 2.2, 1.2);
    this.flash.visible = false;
    this.holder.add(this.flash);
  }

  setWeapon(def: WeaponDef | null): void {
    if (this.model) this.holder.remove(this.model);
    this.model = null;
    this.flash.visible = false;
    if (!def) return;
    this.model = buildWeaponModel(def);
    this.model.traverse((o) => (o.castShadow = false));
    this.holder.add(this.model);
    this.flash.position.copy(this.model.userData.muzzle as THREE.Vector3);
    this.equip = 0;
  }

  /** Recoil push-back, in metres. */
  kick(amount: number): void {
    this.kickZ = Math.min(this.kickZ + amount, 0.16);
  }

  muzzleFlash(): void {
    this.flashT = 0.045;
    this.flash.visible = true;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    this.flash.scale.setScalar(0.16 + Math.random() * 0.08);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** `lookDX/lookDY` are this frame's mouse movement in pixels. */
  update(dt: number, lookDX: number, lookDY: number, speed: number, grounded: boolean): void {
    // Sway: the gun trails the view a little, then catches up.
    const tx = THREE.MathUtils.clamp(-lookDX * 0.0022, -0.07, 0.07);
    const ty = THREE.MathUtils.clamp(-lookDY * 0.0022, -0.07, 0.07);
    this.swayX += (tx - this.swayX) * damp(10, dt);
    this.swayY += (ty - this.swayY) * damp(10, dt);

    // Bob while walking.
    const w = grounded ? Math.min(speed / 9, 1.2) : 0;
    this.bobWeight += (w - this.bobWeight) * damp(10, dt);
    this.bobPhase = (this.bobPhase + speed * dt * 2.6) % (Math.PI * 2);
    const bobX = Math.cos(this.bobPhase) * 0.007 * this.bobWeight;
    const bobY = Math.sin(this.bobPhase * 2) * 0.006 * this.bobWeight;

    this.kickZ *= Math.exp(-16 * dt);
    this.equip = Math.min(1, this.equip + dt / 0.18);
    const lowered = (1 - this.equip) * (1 - this.equip);

    this.holder.position.set(REST.x + this.swayX * 0.6 + bobX, REST.y + this.swayY * 0.5 + bobY - lowered * 0.3, REST.z + this.kickZ);
    this.holder.rotation.set(this.swayY * 0.8 + this.kickZ * 2.6 - lowered * 0.9, this.swayX, this.swayX * 0.6);

    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flash.visible = false;
    }
  }
}

function makeFlashTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,200,110,0.9)');
  g.addColorStop(0.6, 'rgba(255,120,30,0.35)');
  g.addColorStop(1, 'rgba(255,90,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // A few spikes so it reads as a flash rather than a blob.
  ctx.translate(size / 2, size / 2);
  ctx.fillStyle = 'rgba(255,220,160,0.8)';
  for (let i = 0; i < 5; i++) {
    ctx.rotate((Math.PI * 2) / 5);
    ctx.beginPath();
    ctx.moveTo(0, -3);
    ctx.lineTo(size / 2, 0);
    ctx.lineTo(0, 3);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
