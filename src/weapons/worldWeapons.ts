import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { config } from '../config';
import type { Dummies } from '../enemies/dummies';
import { PICKUP_GROUPS, type Physics } from '../physics/physics';
import type { WeaponDef } from './weaponDefs';
import { buildWeaponModel } from './weaponModel';

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A gun lying in (or flying through) the world as a physics object. */
export interface WorldWeapon {
  def: WeaponDef;
  ammo: number;
  body: RAPIER.RigidBody;
  mesh: THREE.Object3D;
  /** Seconds since it was spawned. */
  age: number;
  /** True while a thrown gun can still hurt an enemy. */
  lethal: boolean;
}

/** Owns every loose gun: floor pickups, drops from dead enemies and guns thrown by the player. */
export class WorldWeapons {
  readonly list: WorldWeapon[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: Physics,
  ) {}

  spawn(def: WeaponDef, ammo: number, pos: Vec3, vel?: Vec3, spin?: Vec3, lethal = false): WorldWeapon {
    const m = def.model;
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setCcdEnabled(true);
    if (vel) desc.setLinvel(vel.x, vel.y, vel.z);
    if (spin) desc.setAngvel(spin);
    const body = this.physics.world.createRigidBody(desc);
    // Loose guns collide with the world and enemies but not with the player capsule.
    this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(m.width / 2 + 0.03, m.height / 2 + 0.05, m.length / 2)
        .setTranslation(0, -0.02, -m.length * 0.2)
        .setDensity(4)
        .setRestitution(0.25)
        .setFriction(0.9)
        .setCollisionGroups(PICKUP_GROUPS),
      body,
    );
    const mesh = buildWeaponModel(def);
    mesh.scale.setScalar(1.4); // a little oversized so guns on the floor read from across the room
    mesh.position.set(pos.x, pos.y, pos.z);
    this.scene.add(mesh);
    this.physics.track(body, mesh);

    const w: WorldWeapon = { def, ammo, body, mesh, age: 0, lethal };
    this.list.push(w);
    return w;
  }

  remove(w: WorldWeapon): void {
    const i = this.list.indexOf(w);
    if (i < 0) return;
    this.list.splice(i, 1);
    this.physics.untrack(w.body);
    this.physics.world.removeRigidBody(w.body);
    this.scene.remove(w.mesh);
  }

  /** Closest loose gun to a point, within `maxDist`, that passes `filter`. */
  nearest(p: Vec3, maxDist: number, filter?: (w: WorldWeapon) => boolean): WorldWeapon | null {
    let best: WorldWeapon | null = null;
    let bestD = maxDist;
    for (const w of this.list) {
      if (filter && !filter(w)) continue;
      const t = w.body.translation();
      const d = Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    }
    return best;
  }

  /**
   * Per physics tick: age the guns and resolve thrown ones hitting enemies.
   * `onHit(killed)` fires when a thrown gun connects.
   */
  update(dt: number, dummies?: Dummies, onHit?: (killed: boolean) => void): void {
    const cfg = config.weapons;
    for (const w of this.list) {
      w.age += dt;
      if (!w.lethal) continue;
      const v = w.body.linvel();
      if (w.age > cfg.throwLethalTime || Math.hypot(v.x, v.y, v.z) < cfg.throwLethalSpeed) {
        w.lethal = false;
        continue;
      }
      if (!dummies) continue;
      const t = w.body.translation();
      for (const d of dummies.list) {
        if (!d.alive) continue;
        const dy = t.y - d.pos.y;
        if (dy < -0.2 || dy > 2.0 || Math.hypot(t.x - d.pos.x, t.z - d.pos.z) > 0.6) continue;
        const killed = dummies.hitByThrown(d);
        w.lethal = false;
        // Drop out of the air next to the target rather than ricocheting across the room.
        w.body.setLinvel({ x: -v.x * 0.06, y: 2, z: -v.z * 0.06 }, true);
        onHit?.(killed);
        break;
      }
    }
  }
}
