import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { config } from '../config';
import type { Physics } from '../physics/physics';
import { WEAPONS, type WeaponId } from '../weapons/weaponDefs';
import { buildWeaponModel } from '../weapons/weaponModel';
import type { WorldWeapons } from '../weapons/worldWeapons';

export interface DummySpec {
  x: number;
  y: number;
  z: number;
  /** Facing; 0 looks down -Z. */
  yaw: number;
  weapon: WeaponId;
}

const HEIGHT = 1.8;
const HEAD_FROM = 1.38;
const RED = new THREE.Color(0xd9434a);
const WHITE = new THREE.Color(0xffffff);
const STUN = new THREE.Color(0x35e0ff);

export class Dummy {
  health = config.dummies.health;
  alive = true;
  stunT = 0;
  /** Seconds until it comes back after dying. */
  respawnT = 0;
  flashT = 0;
  deathT = 0;
  collider: RAPIER.Collider | null = null;
  readonly pos: { x: number; y: number; z: number };
  readonly group = new THREE.Group();
  readonly material = new THREE.MeshStandardMaterial({ color: RED, roughness: 0.6 });
  readonly gun: THREE.Object3D;

  constructor(readonly spec: DummySpec) {
    this.pos = { x: spec.x, y: spec.y, z: spec.z };
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.3, 0.35), this.material);
    body.position.y = 0.65;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), this.material);
    head.position.y = 1.55;
    body.castShadow = head.castShadow = true;
    this.gun = buildWeaponModel(WEAPONS[spec.weapon]);
    this.gun.position.set(0.38, 1.0, -0.2);
    this.group.add(body, head, this.gun);
    this.group.position.set(spec.x, spec.y, spec.z);
    this.group.rotation.y = spec.yaw;
  }

  get stunned(): boolean {
    return this.stunT > 0;
  }
}

/**
 * Stationary target dummies: they take damage, can be stunned, die, drop the
 * gun they were holding and come back a few seconds later. No AI yet.
 */
export class Dummies {
  readonly list: Dummy[] = [];
  private readonly byCollider = new Map<number, Dummy>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: Physics,
    private readonly worldWeapons: WorldWeapons,
  ) {}

  add(spec: DummySpec): Dummy {
    const d = new Dummy(spec);
    this.scene.add(d.group);
    this.list.push(d);
    this.attachCollider(d);
    return d;
  }

  byHandle(handle: number): Dummy | undefined {
    return this.byCollider.get(handle);
  }

  isHeadshot(d: Dummy, hitY: number): boolean {
    return hitY - d.pos.y >= HEAD_FROM;
  }

  /** Apply damage. Returns true if this killed it. */
  damage(d: Dummy, amount: number): boolean {
    if (!d.alive) return false;
    d.health -= amount;
    d.flashT = 0.09;
    if (d.health > 0) return false;
    this.kill(d);
    return true;
  }

  /** A thrown gun connected: heavy damage plus a stun, or a kill if it was already hurt. */
  hitByThrown(d: Dummy): boolean {
    const killed = this.damage(d, config.weapons.throwDamage);
    if (!killed) d.stunT = config.weapons.stunTime;
    return killed;
  }

  update(dt: number): void {
    for (const d of this.list) {
      if (!d.alive) {
        if (d.deathT > 0) {
          d.deathT = Math.max(0, d.deathT - dt);
          const k = d.deathT / 0.25;
          d.group.scale.set(1 + (1 - k) * 0.3, Math.max(k, 0.001), 1 + (1 - k) * 0.3);
          if (d.deathT === 0) d.group.visible = false;
        }
        d.respawnT -= dt;
        if (d.respawnT <= 0) this.respawn(d);
        continue;
      }
      d.stunT = Math.max(0, d.stunT - dt);
      d.flashT = Math.max(0, d.flashT - dt);
      d.group.rotation.x = d.stunned ? 0.3 + Math.sin(d.stunT * 18) * 0.04 : 0;
      if (d.flashT > 0) d.material.emissive.copy(WHITE).multiplyScalar(1.5);
      else if (d.stunned) d.material.emissive.copy(STUN).multiplyScalar(0.6);
      else d.material.emissive.setScalar(0);
    }
  }

  private kill(d: Dummy): void {
    d.alive = false;
    d.health = 0;
    d.stunT = 0;
    d.deathT = 0.25;
    d.respawnT = config.dummies.respawnTime;
    d.material.emissive.copy(WHITE).multiplyScalar(2);
    d.gun.visible = false;
    if (d.collider) {
      this.byCollider.delete(d.collider.handle);
      this.physics.world.removeCollider(d.collider, false);
      d.collider = null;
    }
    // The gun it was holding falls to the floor, fully loaded, ready to be grabbed.
    const def = WEAPONS[d.spec.weapon];
    this.worldWeapons.spawn(
      def,
      def.ammo,
      { x: d.pos.x, y: d.pos.y + 1.1, z: d.pos.z },
      { x: (Math.random() - 0.5) * 1.5, y: 3, z: (Math.random() - 0.5) * 1.5 },
      { x: 3, y: 5, z: 2 },
    );
  }

  private respawn(d: Dummy): void {
    d.alive = true;
    d.health = config.dummies.health;
    d.group.visible = true;
    d.group.scale.setScalar(1);
    d.gun.visible = true;
    d.material.emissive.setScalar(0);
    this.attachCollider(d);
  }

  private attachCollider(d: Dummy): void {
    const half = HEIGHT / 2 - 0.35;
    d.collider = this.physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(half, 0.35).setTranslation(d.pos.x, d.pos.y + HEIGHT / 2, d.pos.z),
    );
    this.byCollider.set(d.collider.handle, d);
  }
}
