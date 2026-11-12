import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { config } from '../config';
import type { Dummies } from '../enemies/dummies';
import { HITSCAN_GROUPS, type Physics } from '../physics/physics';
import type { PlayerController } from '../player/playerController';
import type { WeaponEffects } from './effects';
import type { Viewmodel } from './viewmodel';
import { WEAPONS, type WeaponDef, type WeaponId } from './weaponDefs';
import type { WorldWeapon, WorldWeapons } from './worldWeapons';

export interface WeaponInput {
  fireHeld: boolean;
  /** True on the frame the trigger went down. */
  firePressed: boolean;
  throwPressed: boolean;
  pickupPressed: boolean;
}

/** Feel hooks, so the system itself stays free of camera/HUD details. */
export interface WeaponHooks {
  /** View kick in radians. */
  recoil?(pitch: number, yaw: number): void;
  shake?(amount: number): void;
  /** A shot or a thrown gun hurt an enemy. */
  hit?(killed: boolean, headshot: boolean): void;
}

const DEG = Math.PI / 180;
const TRACER_MAX = 60;

/**
 * The player's gun: hitscan firing, throwing and picking up.
 * One gun at a time and no reloading: when it's empty, pulling the trigger throws it.
 */
export class WeaponSystem {
  current: { def: WeaponDef; ammo: number } | null = null;
  /** Gun in reach that E would pick up, for the HUD. */
  nearby: WorldWeapon | null = null;
  shotsFired = 0;

  private cooldown = 0;
  private fireBufferT = 0;

  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  private readonly muzzle = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();

  constructor(
    private readonly o: {
      physics: Physics;
      camera: THREE.Camera;
      player: PlayerController;
      dummies: Dummies;
      world: WorldWeapons;
      effects: WeaponEffects;
      viewmodel?: Viewmodel;
      hooks?: WeaponHooks;
    },
  ) {}

  give(id: WeaponId, ammo = WEAPONS[id].ammo): void {
    this.current = { def: WEAPONS[id], ammo };
    this.o.viewmodel?.setWeapon(this.current.def);
  }

  update(dt: number, input: WeaponInput): void {
    const cfg = config.weapons;
    const { player, world } = this.o;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.fireBufferT = input.firePressed ? cfg.fireBuffer : Math.max(0, this.fireBufferT - dt);
    this.basis();

    // --- Picking up ---------------------------------------------------------
    const chest = { x: player.feet.x, y: player.feet.y + 1, z: player.feet.z };
    this.nearby = world.nearest(chest, cfg.pickupRange, (w) => w.age > 0.35);
    if (input.pickupPressed && this.nearby) {
      this.pickUp(this.nearby);
    } else if (!this.current) {
      // Empty-handed: walking over a loaded gun grabs it.
      const w = world.nearest(player.feet, cfg.autoPickupRange, (g) => g.ammo > 0 && g.age > 0.5 && !g.lethal);
      if (w) this.pickUp(w);
    }

    // --- Throwing / firing ---------------------------------------------------
    if (!this.current) return;
    if (input.throwPressed) {
      this.throwCurrent();
      return;
    }
    const { def } = this.current;
    const wantFire = def.auto ? input.fireHeld || this.fireBufferT > 0 : this.fireBufferT > 0;
    if (!wantFire || this.cooldown > 0) return;
    if (this.current.ammo > 0) this.fire();
    else if (this.fireBufferT > 0) this.throwCurrent(); // dry trigger pull: throw it
    this.fireBufferT = 0;
  }

  private basis(): void {
    const q = this.o.camera.quaternion;
    this.fwd.set(0, 0, -1).applyQuaternion(q);
    this.right.set(1, 0, 0).applyQuaternion(q);
    this.up.set(0, 1, 0).applyQuaternion(q);
  }

  private fire(): void {
    const { physics, camera, dummies, effects, viewmodel, hooks } = this.o;
    const cur = this.current!;
    const def = cur.def;
    cur.ammo--;
    this.shotsFired++;
    this.cooldown = 1 / def.fireRate;

    const origin = camera.position;
    // Roughly where the viewmodel's muzzle sits in the world; tracers start here.
    this.muzzle.copy(origin).addScaledVector(this.fwd, 0.75).addScaledVector(this.right, 0.17).addScaledVector(this.up, -0.13);

    let hitEnemy = false;
    let killed = false;
    let headshot = false;
    const spread = Math.tan(def.spreadDeg * DEG);

    for (let i = 0; i < def.pellets; i++) {
      // Uniform point in the spread cone.
      const r = spread * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      this.dir.copy(this.fwd).addScaledVector(this.right, r * Math.cos(a)).addScaledVector(this.up, r * Math.sin(a)).normalize();

      const hit = physics.world.castRayAndGetNormal(
        new RAPIER.Ray(origin, this.dir), def.range, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, HITSCAN_GROUPS,
      );
      if (!hit) {
        effects.tracer(this.muzzle, this.end.copy(origin).addScaledVector(this.dir, Math.min(def.range, TRACER_MAX)));
        continue;
      }
      this.end.copy(origin).addScaledVector(this.dir, hit.timeOfImpact);
      this.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
      effects.tracer(this.muzzle, this.end);

      const dummy = dummies.byHandle(hit.collider.handle);
      if (dummy && dummy.alive) {
        const head = dummies.isHeadshot(dummy, this.end.y);
        hitEnemy = true;
        headshot ||= head;
        if (dummies.damage(dummy, def.damage * (head ? def.headshotMultiplier : 1))) killed = true;
        effects.impact(this.end, this.normal, false, 8);
      } else {
        effects.impact(this.end, this.normal, true, 5);
      }
    }

    effects.muzzleFlash(this.muzzle);
    viewmodel?.muzzleFlash();
    viewmodel?.kick(def.recoil.kick);
    hooks?.recoil?.(def.recoil.pitchDeg * DEG, (Math.random() * 2 - 1) * def.recoil.yawDeg * DEG);
    hooks?.shake?.(def.recoil.shake);
    if (hitEnemy) hooks?.hit?.(killed, headshot);
  }

  /** Throw the held gun. It becomes a physics object that stuns or kills what it hits. */
  throwCurrent(): void {
    const cur = this.current;
    if (!cur) return;
    const cfg = config.weapons;
    const { camera, player, world, viewmodel } = this.o;
    this.basis();
    const p = this.end.copy(camera.position).addScaledVector(this.fwd, 0.5).addScaledVector(this.right, 0.14).addScaledVector(this.up, -0.08);
    const v = player.velocity;
    world.spawn(
      cur.def,
      cur.ammo,
      p,
      { x: this.fwd.x * cfg.throwSpeed + v.x, y: this.fwd.y * cfg.throwSpeed + 2 + Math.max(v.y, 0), z: this.fwd.z * cfg.throwSpeed + v.z },
      { x: -14 * this.right.x, y: -14 * this.right.y, z: -14 * this.right.z },
      true,
    );
    this.current = null;
    this.cooldown = 0.15;
    viewmodel?.setWeapon(null);
    viewmodel?.kick(0.08);
  }

  private pickUp(w: WorldWeapon): void {
    const { camera, world, viewmodel } = this.o;
    if (this.current) {
      // Swap: the gun in hand is dropped at our feet (not thrown, so it's harmless).
      const p = this.end.copy(camera.position).addScaledVector(this.fwd, 0.45).addScaledVector(this.up, -0.3);
      world.spawn(this.current.def, this.current.ammo, p, { x: this.fwd.x * 2, y: 1.5, z: this.fwd.z * 2 }, { x: 2, y: 3, z: 1 });
    }
    this.current = { def: w.def, ammo: w.ammo };
    world.remove(w);
    this.nearby = null;
    this.cooldown = 0.2;
    viewmodel?.setWeapon(w.def);
  }
}
