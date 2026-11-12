import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { Dummies } from '../src/enemies/dummies';
import { FIXED_DT, Physics } from '../src/physics/physics';
import { PlayerController } from '../src/player/playerController';
import { WeaponEffects } from '../src/weapons/effects';
import { WEAPONS, type WeaponId } from '../src/weapons/weaponDefs';
import { WeaponSystem, type WeaponInput } from '../src/weapons/weaponSystem';
import { WorldWeapons } from '../src/weapons/worldWeapons';

const DT = FIXED_DT;
const idle: WeaponInput = { fireHeld: false, firePressed: false, throwPressed: false, pickupPressed: false };

/** Player at the origin looking down -Z across a flat floor, with a back wall at z = -40. */
async function setup(start: WeaponId = 'pistol') {
  const physics = await Physics.create();
  physics.addStaticBox({ x: 200, y: 1, z: 200 }, { x: 0, y: -0.5, z: 0 });
  physics.addStaticBox({ x: 200, y: 40, z: 1 }, { x: 0, y: 20, z: -40.5 });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const player = new PlayerController(physics, config.player, { x: 0, y: 0, z: 0 });
  const world = new WorldWeapons(scene, physics);
  const dummies = new Dummies(scene, physics, world);
  const events = { hits: 0, kills: 0, headshots: 0, recoil: 0, shake: 0 };
  const weapons = new WeaponSystem({
    physics, camera, player, dummies, world, effects: new WeaponEffects(scene),
    hooks: {
      hit: (k, h) => { events.hits++; if (k) events.kills++; if (h) events.headshots++; },
      recoil: (p) => { events.recoil += p; },
      shake: (a) => { events.shake += a; },
    },
  });
  weapons.give(start);

  const aimAt = (x: number, y: number, z: number) => {
    camera.position.set(player.feet.x, player.feet.y + 1.62, player.feet.z);
    camera.lookAt(x, y, z);
  };
  /** One physics tick plus one weapon update. */
  const tick = (input: Partial<WeaponInput> = {}) => {
    player.fixedUpdate(DT, { moveX: 0, moveZ: 0, yaw: 0, jumpPressed: false, jumpHeld: false, sprint: false, crouch: false });
    physics.world.step();
    physics.step(0); // sync meshes
    world.update(DT, dummies, (k) => { events.hits++; if (k) events.kills++; });
    weapons.update(DT, { ...idle, ...input });
    dummies.update(DT);
  };
  const run = (seconds: number, input: Partial<WeaponInput> = {}) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) tick(input);
  };
  /** A full trigger pull, then enough time for any weapon's cooldown. */
  const shoot = () => {
    tick({ firePressed: true, fireHeld: true });
    run(0.8);
  };
  aimAt(0, 1.62, -10);
  run(0.2);
  return { physics, camera, player, world, dummies, weapons, events, aimAt, tick, run, shoot };
}

describe('firing', () => {
  it('pistol is semi-auto: holding the trigger fires once, and each shot costs one round', async () => {
    const t = await setup('pistol');
    t.tick({ firePressed: true, fireHeld: true });
    t.run(1, { fireHeld: true });
    expect(t.weapons.shotsFired).toBe(1);
    expect(t.weapons.current!.ammo).toBe(WEAPONS.pistol.ammo - 1);
    expect(t.events.recoil).toBeGreaterThan(0);
    expect(t.events.shake).toBeGreaterThan(0);
  });

  it('SMG is automatic at its fire rate', async () => {
    const t = await setup('smg');
    t.tick({ firePressed: true, fireHeld: true });
    t.run(1, { fireHeld: true });
    expect(t.weapons.shotsFired).toBeGreaterThanOrEqual(WEAPONS.smg.fireRate - 1);
    expect(t.weapons.shotsFired).toBeLessThanOrEqual(WEAPONS.smg.fireRate + 1);
  });

  it('body shots and headshots do the damage the data says', async () => {
    const t = await setup('pistol');
    const d = t.dummies.add({ x: 0, y: 0, z: -8, yaw: 0, weapon: 'smg' });
    t.aimAt(0, 0.9, -8);
    t.shoot();
    expect(d.health).toBe(config.dummies.health - WEAPONS.pistol.damage);
    t.aimAt(0, 1.55, -8);
    t.shoot();
    // 34 body + 68 head = 102: the headshot finishes it.
    expect(d.alive).toBe(false);
    expect(t.events).toMatchObject({ hits: 2, headshots: 1, kills: 1 });
  });

  it('shotgun fires 8 pellets: lethal up close, weak at range', async () => {
    const near = await setup('shotgun');
    const a = near.dummies.add({ x: 0, y: 0, z: -3, yaw: 0, weapon: 'pistol' });
    near.aimAt(0, 1.0, -3);
    near.shoot();
    expect(a.alive).toBe(false);
    expect(near.events.kills).toBe(1);

    const far = await setup('shotgun');
    const b = far.dummies.add({ x: 0, y: 0, z: -35, yaw: 0, weapon: 'pistol' });
    far.aimAt(0, 1.0, -35);
    far.shoot();
    expect(b.alive).toBe(true);
  });

  it('bullets ignore loose guns lying in the way', async () => {
    const t = await setup('pistol');
    const d = t.dummies.add({ x: 0, y: 0, z: -8, yaw: 0, weapon: 'smg' });
    t.world.spawn(WEAPONS.shotgun, 4, { x: 0, y: 0.9, z: -4 });
    t.aimAt(0, 0.9, -8);
    t.tick({ firePressed: true });
    expect(d.health).toBeLessThan(config.dummies.health);
  });
});

describe('empty → throw → grab loop', () => {
  it('runs the whole loop against two dummies', async () => {
    const t = await setup('pistol');
    const first = t.dummies.add({ x: 0, y: 0, z: -6, yaw: 0, weapon: 'smg' });
    const second = t.dummies.add({ x: 3, y: 0, z: -6, yaw: 0, weapon: 'shotgun' });

    // 1. Shoot the first dummy dead (3 body shots), which drops its SMG.
    t.aimAt(0, 0.9, -6);
    for (let i = 0; i < 3; i++) t.shoot();
    expect(first.alive).toBe(false);
    expect(t.world.list.map((w) => w.def.id)).toEqual(['smg']);
    expect(t.world.list[0].ammo).toBe(WEAPONS.smg.ammo);

    // 2. Empty the pistol into the back wall.
    t.aimAt(-10, 3, -40);
    while (t.weapons.current!.ammo > 0) t.shoot();
    expect(t.weapons.shotsFired).toBe(WEAPONS.pistol.ammo);

    // 3. Pull the trigger on the empty gun while aiming at the second dummy: it is thrown and stuns.
    t.aimAt(3, 1.1, -6);
    t.tick({ firePressed: true });
    expect(t.weapons.current).toBeNull();
    expect(t.world.list.some((w) => w.def.id === 'pistol' && w.lethal)).toBe(true);
    t.run(0.6);
    expect(second.alive).toBe(true);
    expect(second.stunned).toBe(true);
    expect(second.health).toBe(config.dummies.health - config.weapons.throwDamage);

    // 4. Walk over the dead dummy's SMG with empty hands: picked up automatically, loaded.
    const smg = t.world.list.find((w) => w.def.id === 'smg')!;
    const p = smg.body.translation();
    t.player.teleport({ x: p.x, y: 0.02, z: p.z + 0.5 });
    t.run(0.1);
    expect(t.weapons.current?.def.id).toBe('smg');
    expect(t.weapons.current?.ammo).toBe(WEAPONS.smg.ammo);
    // The thrown, empty pistol is not auto-grabbed.
    expect(t.world.list.map((w) => w.def.id)).toEqual(['pistol']);

    // 5. Finish the stunned dummy with the new gun.
    t.aimAt(3, 0.9, -6);
    t.run(0.6, { fireHeld: true });
    expect(second.alive).toBe(false);
    expect(t.events.kills).toBe(2);
  });

  it('a thrown gun kills an enemy that is already hurt, and right-click throws a loaded gun', async () => {
    const t = await setup('smg');
    const d = t.dummies.add({ x: 0, y: 0, z: -5, yaw: 0, weapon: 'pistol' });
    t.dummies.damage(d, 60);
    t.aimAt(0, 1.1, -5);
    t.tick({ throwPressed: true });
    expect(t.weapons.current).toBeNull();
    t.run(0.6);
    expect(d.alive).toBe(false);
    expect(t.events.kills).toBe(1);
    // The thrown SMG keeps its rounds.
    expect(t.world.list.find((w) => w.def.id === 'smg')!.ammo).toBe(WEAPONS.smg.ammo);
  });

  it('E swaps the held gun for the one on the floor', async () => {
    const t = await setup('pistol');
    t.world.spawn(WEAPONS.shotgun, 3, { x: 0, y: 0.3, z: -1 });
    t.run(0.5);
    expect(t.weapons.nearby?.def.id).toBe('shotgun');
    expect(t.weapons.current?.def.id).toBe('pistol'); // not auto-picked while armed
    t.tick({ pickupPressed: true });
    expect(t.weapons.current).toMatchObject({ ammo: 3 });
    expect(t.weapons.current?.def.id).toBe('shotgun');
    expect(t.world.list.map((w) => w.def.id)).toEqual(['pistol']);
  });

  it('dead dummies come back after the respawn time', async () => {
    const t = await setup('pistol');
    const d = t.dummies.add({ x: 0, y: 0, z: -6, yaw: 0, weapon: 'smg' });
    t.dummies.damage(d, 999);
    expect(d.alive).toBe(false);
    t.run(config.dummies.respawnTime + 0.2);
    expect(d.alive).toBe(true);
    expect(d.health).toBe(config.dummies.health);
  });
});
