import RAPIER from '@dimforge/rapier3d-compat';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { FIXED_DT, Physics } from '../src/physics/physics';
import { PlayerController, type PlayerInput } from '../src/player/playerController';

const cfg = config.player;
const DT = FIXED_DT;

type Partial_ = Partial<PlayerInput>;

async function setup(spawn = { x: 0, y: 0, z: 0 }) {
  const physics = await Physics.create();
  physics.addStaticBox({ x: 400, y: 1, z: 400 }, { x: 0, y: -0.5, z: 0 }); // floor, top at y=0
  const player = new PlayerController(physics, cfg, spawn);
  let time = 0;
  const tick = (input: Partial_ = {}) => {
    player.fixedUpdate(DT, {
      moveX: 0, moveZ: 0, yaw: 0, jumpPressed: false, jumpHeld: false, sprint: false, crouch: false, ...input,
    });
    physics.world.step();
    time += DT;
  };
  /** Run for `seconds`; `fn` returns the input for each tick (or false to stop early). */
  const run = (seconds: number, fn: (t: number) => Partial_ | false = () => ({})) => {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) {
      const input = fn(i * DT);
      if (input === false) return;
      tick(input);
    }
  };
  return { physics, player, tick, run, now: () => time };
}

/** Wedge hull: footprint w × l, height 0 at +z rising to h at -z (same as the test room ramps). */
function wedge(physics: Physics, w: number, h: number, l: number, pos: { x: number; y: number; z: number }) {
  const x = w / 2, z = l / 2;
  physics.addStaticHull(new Float32Array([-x, 0, z, x, 0, z, x, 0, -z, -x, 0, -z, -x, h, -z, x, h, -z]), pos);
}

describe('ground movement', () => {
  it('reaches walk speed quickly, holds it, and stops crisply', async () => {
    const { player, run } = await setup();
    run(0.3);
    expect(player.grounded).toBe(true);

    run(0.25, () => ({ moveZ: 1 }));
    expect(player.horizontalSpeed).toBeGreaterThan(cfg.walkSpeed * 0.9); // tight: ~full speed in 250 ms
    run(1, () => ({ moveZ: 1 }));
    expect(player.horizontalSpeed).toBeCloseTo(cfg.walkSpeed, 2);
    expect(player.velocity.z).toBeLessThan(0); // yaw 0 faces -Z

    run(0.35);
    expect(player.horizontalSpeed).toBe(0); // not floaty: dead stop within 350 ms
    expect(player.feet.y).toBeCloseTo(cfg.skin, 2);
  });

  it('sprints at sprint speed', async () => {
    const { player, run } = await setup();
    run(1.5, () => ({ moveZ: 1, sprint: true }));
    expect(player.horizontalSpeed).toBeCloseTo(cfg.sprintSpeed, 2);
  });

  it('walks up a 27° ramp', async () => {
    const { physics, player, run } = await setup({ x: 0, y: 0, z: 4 });
    wedge(physics, 4, 2, 4, { x: 0, y: 0, z: 0 });
    physics.addStaticBox({ x: 4, y: 2, z: 6 }, { x: 0, y: 1, z: -5 });
    run(0.2);
    let airTicks = 0;
    run(2, () => {
      if (!player.grounded) airTicks++;
      return { moveZ: 1 };
    });
    expect(player.feet.y).toBeGreaterThan(1.95);
    expect(player.grounded).toBe(true);
    expect(airTicks).toBeLessThan(6);
  });
});

describe('jumping', () => {
  it('bunny-hopping with buffered jumps holds speed', async () => {
    const { player, run } = await setup();
    run(1.5, () => ({ moveZ: 1, sprint: true }));
    const start = player.horizontalSpeed;
    let min = Infinity;
    let hops = 0;
    let lastVy = 0;
    run(5, () => {
      if (player.velocity.y > 5 && lastVy <= 0) hops++;
      lastVy = player.velocity.y;
      min = Math.min(min, player.horizontalSpeed);
      // Press shortly before touching down, like a player would.
      const press = player.grounded || (player.velocity.y < 0 && player.feet.y < 0.35);
      return { moveZ: 1, sprint: true, jumpPressed: press };
    });
    expect(hops).toBeGreaterThanOrEqual(6);
    expect(min).toBeGreaterThan(start - 0.01);
  });

  it('air strafing gains speed but is capped', async () => {
    const { player, run } = await setup();
    run(1.5, () => ({ moveZ: 1, sprint: true }));
    let max = 0;
    let at3s = 0;
    run(25, (t) => {
      max = Math.max(max, player.horizontalSpeed);
      if (Math.abs(t - 3) < DT) at3s = player.horizontalSpeed;
      // Strafe right while turning so the wish direction stays nearly perpendicular to velocity.
      const v = player.velocity;
      const s = Math.max(player.horizontalSpeed, 1e-3);
      const a = Math.acos(Math.min(1, (cfg.airWishSpeed * 0.5) / s));
      const dx = v.x / s, dz = v.z / s;
      const wx = dx * Math.cos(a) - dz * Math.sin(a);
      const wz = dx * Math.sin(a) + dz * Math.cos(a);
      const yaw = Math.atan2(-wz, wx);
      const press = player.grounded || (player.velocity.y < 0 && player.feet.y < 0.35);
      return { moveX: 1, yaw, sprint: true, jumpPressed: press };
    });
    expect(at3s).toBeGreaterThan(cfg.sprintSpeed + 1);
    expect(max).toBeGreaterThan(cfg.airStrafeSpeedCap - 0.5);
    expect(max).toBeLessThanOrEqual(cfg.airStrafeSpeedCap + 1e-6);
  });

  it('holding forward in the air gives almost no acceleration from rest', async () => {
    const { player, run, tick } = await setup();
    run(0.2);
    tick({ jumpPressed: true });
    run(0.3, () => ({ moveZ: 1 }));
    expect(player.grounded).toBe(false);
    expect(player.horizontalSpeed).toBeLessThanOrEqual(cfg.airWishSpeed + 1e-6);
  });

  it('jump height and air time match gravity / jump speed', async () => {
    const { player, run, tick } = await setup();
    run(0.2);
    tick({ jumpPressed: true });
    let apex = 0;
    let air = DT;
    run(2, () => {
      if (player.grounded) return false;
      apex = Math.max(apex, player.feet.y);
      air += DT;
      return {};
    });
    expect(apex).toBeCloseTo(cfg.jumpSpeed ** 2 / (2 * cfg.gravity), 1);
    expect(air).toBeCloseTo((2 * cfg.jumpSpeed) / cfg.gravity, 1);
    expect(player.landingImpact).toBeGreaterThan(cfg.jumpSpeed * 0.9);
  });

  it('buffers a jump pressed 80 ms before landing, but not 200 ms before', async () => {
    const airTime = (2 * cfg.jumpSpeed) / cfg.gravity;
    for (const [early, expectJump] of [[0.08, true], [0.2, false]] as const) {
      const { player, run, tick } = await setup();
      run(0.2);
      tick({ jumpPressed: true });
      run(airTime - early - DT);
      expect(player.grounded).toBe(false);
      tick({ jumpPressed: true });
      run(early + 0.08);
      expect(player.velocity.y > 0).toBe(expectJump);
      expect(player.grounded).toBe(!expectJump);
    }
  });

  it('coyote time: can jump 80 ms after leaving a ledge, not 150 ms after', async () => {
    for (const [late, expectJump] of [[0.08, true], [0.15, false]] as const) {
      const { physics, player, run, tick } = await setup({ x: 0, y: 2, z: 0 });
      physics.addStaticBox({ x: 4, y: 2, z: 4 }, { x: 0, y: 1, z: 0 }); // ledge edge at z = -2
      run(0.2);
      expect(player.grounded).toBe(true);
      run(2, () => (player.grounded ? { moveZ: 1 } : false));
      expect(player.grounded).toBe(false);
      expect(player.feet.y).toBeGreaterThan(1.8);
      run(late - DT, () => ({ moveZ: 1 }));
      tick({ moveZ: 1, jumpPressed: true });
      expect(player.velocity.y > 0).toBe(expectJump);
    }
  });

  it('cannot double-jump using coyote time', async () => {
    const { player, run, tick } = await setup();
    run(0.2);
    tick({ jumpPressed: true });
    run(0.05);
    const vy = player.velocity.y;
    tick({ jumpPressed: true });
    expect(player.velocity.y).toBeLessThan(vy);
  });
});

describe('collision response', () => {
  it('slides along a wall with no jitter and no speed exploit', async () => {
    const { physics, player, run } = await setup({ x: 3, y: 0, z: 0 });
    physics.addStaticBox({ x: 1, y: 8, z: 200 }, { x: 5.5, y: 4, z: 0 }); // wall face at x = 5
    run(0.2);
    const yaw = -Math.PI / 4; // forward = (+x, -z) diagonal into the wall
    run(1, () => ({ moveZ: 1, yaw, sprint: true }));
    const xs: number[] = [];
    const ys: number[] = [];
    run(2, () => {
      xs.push(player.feet.x);
      ys.push(player.feet.y);
      return { moveZ: 1, yaw, sprint: true };
    });
    const range = (a: number[]) => Math.max(...a) - Math.min(...a);
    const maxStep = (a: number[]) => Math.max(...a.slice(1).map((v, i) => Math.abs(v - a[i])));
    // Sub-millimetre: nothing the camera could show as jitter.
    expect(maxStep(xs)).toBeLessThan(3e-4);
    expect(range(xs)).toBeLessThan(2e-3);
    expect(range(ys)).toBeLessThan(1e-6);
    expect(Math.max(...xs)).toBeLessThan(5 - cfg.radius); // never touches / penetrates
    expect(Math.max(...xs)).toBeGreaterThan(5 - cfg.radius - 0.05);
    expect(Math.abs(player.velocity.x)).toBeLessThan(0.05);
    expect(-player.velocity.z).toBeGreaterThan(5); // still moving along the wall
    expect(player.horizontalSpeed).toBeLessThanOrEqual(cfg.sprintSpeed + 1e-6);
    expect(player.grounded).toBe(true);
  });

  it('stops dead running straight into a wall and stays grounded', async () => {
    const { physics, player, run } = await setup({ x: 3, y: 0, z: 0 });
    physics.addStaticBox({ x: 1, y: 8, z: 200 }, { x: 5.5, y: 4, z: 0 });
    const yaw = -Math.PI / 2; // forward = +x
    run(1.5, () => ({ moveZ: 1, yaw, sprint: true }));
    const xs: number[] = [];
    let airTicks = 0;
    run(1, () => {
      xs.push(player.feet.x);
      if (!player.grounded) airTicks++;
      return { moveZ: 1, yaw, sprint: true };
    });
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1e-4);
    expect(airTicks).toBe(0);
  });

  it('bonks off a low ceiling and falls straight away', async () => {
    const { physics, player, run, tick } = await setup();
    physics.addStaticBox({ x: 4, y: 0.5, z: 4 }, { x: 0, y: 2.65, z: 0 }); // underside at 2.4
    run(0.2);
    tick({ jumpPressed: true });
    let apex = 0;
    let air = DT;
    let stuck = 0;
    run(2, () => {
      if (player.grounded) return false;
      apex = Math.max(apex, player.feet.y);
      // "stuck" = pressed against the ceiling while still carrying upward velocity
      if (player.feet.y > 2.4 - cfg.height - 0.05 && player.velocity.y > 0.5) stuck++;
      air += DT;
      return { jumpHeld: true };
    });
    expect(apex).toBeLessThanOrEqual(2.4 - cfg.height);
    expect(apex).toBeGreaterThan(2.4 - cfg.height - 0.06);
    expect(stuck).toBeLessThanOrEqual(1);
    expect(air).toBeLessThan(0.4); // a free jump lasts ~0.66 s
  });

  it('slides off a 60° slope and cannot climb or jump up it', async () => {
    const h = 6;
    const l = h / Math.tan((60 * Math.PI) / 180);
    // Dropped onto the middle of the slope, holding forward (uphill) and mashing jump.
    {
      const { physics, player, run } = await setup({ x: 0, y: 3.6, z: 0 });
      wedge(physics, 6, h, l, { x: 0, y: 0, z: 0 });
      let groundedOnSlope = 0;
      let maxY = 0;
      run(3, (t) => {
        if (player.grounded && player.feet.y > 0.3) groundedOnSlope++;
        if (t > 0.2) maxY = Math.max(maxY, player.feet.y);
        return { moveZ: 1, sprint: true, jumpPressed: true };
      });
      expect(groundedOnSlope).toBe(0);
      expect(maxY).toBeLessThan(3.6);
      expect(player.feet.z).toBeGreaterThan(l / 2 - 0.2); // ended up back at the foot of the slope
    }
    // Sprinting at it from the floor, mashing jump.
    {
      const { physics, player, run } = await setup({ x: 0, y: 0, z: 6 });
      wedge(physics, 6, h, l, { x: 0, y: 0, z: 0 });
      let groundedOnSlope = 0;
      let maxY = 0;
      run(6, () => {
        if (player.grounded && player.feet.y > 0.3) groundedOnSlope++;
        maxY = Math.max(maxY, player.feet.y);
        return { moveZ: 1, sprint: true, jumpPressed: true };
      });
      expect(groundedOnSlope).toBe(0);
      expect(maxY).toBeLessThan(2.2);
    }
    // Standing still on it: no input at all, must not rest there.
    {
      const { physics, player, run } = await setup({ x: 0, y: 3.2, z: 0 });
      wedge(physics, 6, h, l, { x: 0, y: 0, z: 0 });
      run(2.5);
      expect(player.feet.y).toBeLessThan(0.1);
      expect(player.grounded).toBe(true);
    }
  });
});

describe('slide', () => {
  it('boosts on entry, lowers the capsule, fits under a 1.25 m gap, and cannot stand up inside it', async () => {
    const { physics, player, run } = await setup();
    physics.addStaticBox({ x: 6, y: 2, z: 3 }, { x: 0, y: 2.25, z: -14 }); // underside at 1.25, z -15.5..-12.5
    run(1, () => ({ moveZ: 1, sprint: true }));
    const before = player.horizontalSpeed;
    run(0.1, () => ({ moveZ: 1, sprint: true, crouch: true }));
    expect(player.sliding).toBe(true);
    expect(player.currentHeight).toBe(cfg.crouchHeight);
    expect(player.horizontalSpeed).toBeGreaterThan(before + 1);
    expect(player.horizontalSpeed).toBeLessThanOrEqual(cfg.slide.boostMaxSpeed);

    run(3, () => (player.feet.z > -14 ? { crouch: true } : false));
    expect(player.feet.z).toBeLessThanOrEqual(-14); // made it under the lintel

    run(0.05); // crouch released while under it
    expect(player.crouched).toBe(true);

    run(3, () => ({ moveZ: 1 })); // crouch-walk out the far side, then stand
    expect(player.feet.z).toBeLessThan(-16);
    expect(player.crouched).toBe(false);
  });

  it('a standing player is blocked by the same gap', async () => {
    const { physics, player, run } = await setup();
    physics.addStaticBox({ x: 6, y: 2, z: 3 }, { x: 0, y: 2.25, z: -14 });
    run(4, () => ({ moveZ: 1, sprint: true }));
    expect(player.feet.z).toBeGreaterThan(-12.5 + cfg.radius - 0.01);
  });

  it('slide decays into a crouch-walk and does not re-boost within the cooldown', async () => {
    const { player, run } = await setup();
    run(1, () => ({ moveZ: 1, sprint: true }));
    run(0.05, () => ({ crouch: true }));
    const boosted = player.horizontalSpeed;
    run(0.05);
    run(0.05, () => ({ crouch: true }));
    expect(player.horizontalSpeed).toBeLessThan(boosted);
    run(6, () => ({ crouch: true }));
    expect(player.sliding).toBe(false);
    expect(player.horizontalSpeed).toBe(0);
  });
});

it('rapier is the version the controller was written against', () => {
  expect(RAPIER.version()).toMatch(/^0\.2/);
});
