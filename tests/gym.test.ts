import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { FIXED_DT, Physics } from '../src/physics/physics';
import { PlayerController, type PlayerInput } from '../src/player/playerController';
import { LevelBuilder } from '../src/world/builder';
import { Course } from '../src/world/course';
import { buildGym } from '../src/world/gym';

const DT = FIXED_DT;

async function loadGym() {
  const physics = await Physics.create();
  const level = buildGym(new LevelBuilder(new THREE.Scene(), physics));
  const player = new PlayerController(physics, config.player, level.checkpoints[0]);
  const course = new Course(level, player);
  return { physics, level, player, course };
}

/**
 * A scripted run: always holding forward + sprint, looking straight down the lane,
 * with the other inputs keyed off position. It plays the line a person would:
 * slide, slide-hop, slide, wall-run right, wall-jump, wall-run left, wall-jump,
 * chain wall-jumps up the shaft, slide down the ramp and under the last gate.
 */
function bot(player: PlayerController, state: { wallTicks: number; prevCrouch: boolean }): Partial<PlayerInput> {
  const { x, y, z } = player.feet;
  const input: Partial<PlayerInput> = {};

  // Slide gates on the runway: slide under the first, hop out, land sliding under the second.
  if (z < 39 && z > 34.6) input.crouch = true;
  if (z <= 34.6 && z > 33.8 && player.grounded) input.jumpPressed = true;
  if (z <= 33.8 && z > 22.6) input.crouch = !player.grounded || z < 30;

  // Drift right before the pit so the first wall-run is on the right wall.
  if (z < 22 && z > 16 && x < 1.2) input.moveX = 1;
  if (z <= 16.5 && z > 15 && player.grounded) input.jumpPressed = true;

  // Wall work: after a short moment on each wall, jump off it at the chosen spots.
  state.wallTicks = player.wallRunning ? state.wallTicks + 1 : 0;
  if (player.wallRunning) {
    const onRight = player.wallNormal.x < 0;
    if (z > -7) {
      // Pit: leave the right wall around z=8, leave the left wall just before the landing floor.
      if (onRight && z < 8) input.jumpPressed = true;
      if (!onRight && z < -5) input.jumpPressed = true;
    } else if (z < -17) {
      // Shaft: bounce between the walls as soon as each run is established.
      if (state.wallTicks > 10 && y < 4.2) input.jumpPressed = true;
    }
  }
  // Shaft entry: head for the right wall and jump from the lip.
  if (z < -11 && z > -17 && x < 1.2 && player.grounded) input.moveX = 1;
  if (z <= -16.4 && z > -17.5 && player.grounded) input.jumpPressed = true;

  // Final ramp: slide down it and under the last gate.
  if (z < -46 && z > -62) input.crouch = true;

  return input;
}

describe('movement gym', () => {
  it('a scripted run clears the whole course in one line without stopping or respawning', async () => {
    const { physics, level, player, course } = await loadGym();
    const state = { wallTicks: 0, prevCrouch: false };
    const used = { slide: false, slideHop: false, wallRunRight: false, wallRunLeft: false, wallJumps: 0 };
    let minSpeed = Infinity;
    let maxSpeed = 0;
    let wasWallRunning = false;
    let wasSliding = false;
    const log: string[] = [];

    for (let i = 0; i < 40 / DT && !course.finished; i++) {
      const extra = bot(player, state);
      const vyBefore = player.velocity.y;
      player.fixedUpdate(DT, {
        moveX: 0, moveZ: 1, yaw: 0, jumpPressed: false, jumpHeld: false, sprint: true, crouch: false, ...extra,
      });
      physics.world.step();
      course.update(DT);

      if (player.sliding) used.slide = true;
      if (wasSliding && !player.grounded && player.velocity.y > 5) used.slideHop = true;
      if (player.wallRunning) {
        if (player.wallNormal.x < 0) used.wallRunRight = true;
        else used.wallRunLeft = true;
      }
      if (wasWallRunning && !player.wallRunning && player.velocity.y > vyBefore + 3) used.wallJumps++;
      wasWallRunning = player.wallRunning;
      wasSliding = player.sliding;

      if (course.running && course.time > 1) {
        minSpeed = Math.min(minSpeed, player.horizontalSpeed);
        maxSpeed = Math.max(maxSpeed, player.horizontalSpeed);
      }
      if (i % 12 === 0) {
        const f = player.feet;
        const st = player.wallRunning ? 'WALL' : player.sliding ? 'slide' : player.grounded ? 'ground' : 'air';
        log.push(`${(i * DT).toFixed(1)}s z=${f.z.toFixed(1)} x=${f.x.toFixed(2)} y=${f.y.toFixed(2)} v=${player.horizontalSpeed.toFixed(1)} vy=${player.velocity.y.toFixed(1)} ${st}`);
      }
    }
    if (!course.finished || course.respawns > 0 || process.env.GYM_LOG) console.log(log.join('\n'));
    console.log(`gym run: ${course.time.toFixed(2)} s, speed ${minSpeed.toFixed(1)}–${maxSpeed.toFixed(1)} m/s, wall-jumps ${used.wallJumps}`);

    expect(course.finished).toBe(true);
    expect(course.respawns).toBe(0);
    expect(player.feet.z).toBeLessThan(level.finishZ!);
    expect(used).toMatchObject({ slide: true, slideHop: true, wallRunRight: true, wallRunLeft: true });
    expect(used.wallJumps).toBeGreaterThanOrEqual(4);
    expect(minSpeed).toBeGreaterThan(config.player.walkSpeed); // never slower than a walk: one flowing line
    expect(course.time).toBeLessThan(20);
  });

  it('falling into the pit respawns at the checkpoint before it', async () => {
    const { physics, player, course } = await loadGym();
    let respawned = false;
    for (let i = 0; i < 12 / DT && !respawned; i++) {
      player.fixedUpdate(DT, { moveX: 0, moveZ: 1, yaw: 0, jumpPressed: false, jumpHeld: false, sprint: false, crouch: player.feet.z < 39 });
      physics.world.step();
      if (course.update(DT)) respawned = true;
    }
    expect(respawned).toBe(true);
    expect(course.current).toBe(1);
    expect(player.feet.z).toBeCloseTo(20, 1);
  });
});

describe('wall-run rules', () => {
  async function corridor(tagRight: boolean) {
    const physics = await Physics.create();
    physics.addStaticBox({ x: 400, y: 1, z: 400 }, { x: 0, y: -0.5, z: 0 });
    const right = physics.addStaticBox({ x: 1, y: 20, z: 200 }, { x: 2.5, y: 10, z: 0 });
    if (tagRight) physics.tag(right, 'wallrun');
    const player = new PlayerController(physics, config.player, { x: 1.4, y: 0, z: 50 });
    const tick = (input: Partial<PlayerInput> = {}) => {
      player.fixedUpdate(DT, { moveX: 0, moveZ: 1, yaw: 0, jumpPressed: false, jumpHeld: false, sprint: true, crouch: false, ...input });
      physics.world.step();
    };
    const run = (s: number, fn: () => Partial<PlayerInput> = () => ({})) => {
      for (let i = 0; i < Math.round(s / DT); i++) tick(fn());
    };
    return { player, tick, run };
  }

  it('only attaches to tagged walls', async () => {
    const { player, tick, run } = await corridor(false);
    run(1.2);
    tick({ jumpPressed: true });
    let attached = false;
    run(0.5, () => {
      attached ||= player.wallRunning;
      return { moveX: 1 };
    });
    expect(attached).toBe(false);
  });

  it('runs with ~20% gravity, ends after 1.5 s, and will not re-attach to the same wall', async () => {
    const { player, tick, run } = await corridor(true);
    run(1.2);
    tick({ jumpPressed: true });
    run(0.15, () => ({ moveX: 1 }));
    expect(player.wallRunning).toBe(true);
    expect(player.grounded).toBe(false);

    const vy0 = player.velocity.y;
    run(0.5);
    const g = (vy0 - player.velocity.y) / 0.5;
    expect(g).toBeCloseTo(config.player.gravity * config.player.wallrun.gravityScale, 0);
    expect(player.horizontalSpeed).toBeGreaterThan(config.player.sprintSpeed - 0.5);

    // From higher up, so the run times out in the air rather than by landing.
    player.teleport({ x: 1.4, y: 6, z: 40 });
    player.velocity.z = -9;
    let ticksOnWall = 0;
    let reattached = false;
    let ended = false;
    run(2.2, () => {
      if (player.wallRunning) {
        ticksOnWall++;
        if (ended) reattached = true;
      } else if (ticksOnWall > 0 && !player.grounded) ended = true;
      return { moveX: 1 };
    });
    expect(ticksOnWall * DT).toBeGreaterThan(config.player.wallrun.maxTime - 0.1);
    expect(ticksOnWall * DT).toBeLessThanOrEqual(config.player.wallrun.maxTime + 0.02);
    expect(ended).toBe(true);
    expect(reattached).toBe(false);
  });

  it('wall-jump pushes off along the normal and up, keeping forward speed', async () => {
    const { player, tick, run } = await corridor(true);
    run(1.2);
    tick({ jumpPressed: true });
    run(0.3, () => ({ moveX: 1 }));
    expect(player.wallRunning).toBe(true);
    const forward = -player.velocity.z;
    tick({ jumpPressed: true });
    expect(player.wallRunning).toBe(false);
    expect(-player.velocity.z).toBeGreaterThan(forward - 0.2);
    expect(player.velocity.x).toBeLessThan(-config.player.wallrun.jumpPush + 0.5); // away from the right-hand wall
    expect(player.velocity.y).toBeGreaterThan(config.player.wallrun.jumpUp - 0.5);
  });
});
