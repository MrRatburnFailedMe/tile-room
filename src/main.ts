import * as THREE from 'three';
import { CameraRig } from './camera/cameraRig';
import { config } from './config';
import { StatsOverlay } from './debug/statsOverlay';
import { Dummies } from './enemies/dummies';
import { Input } from './input';
import { Physics } from './physics/physics';
import { PlayerController, type PlayerInput } from './player/playerController';
import { PlayerView } from './player/playerView';
import { RenderPipeline } from './render/pipeline';
import { WeaponEffects } from './weapons/effects';
import { Viewmodel } from './weapons/viewmodel';
import { WEAPONS } from './weapons/weaponDefs';
import { WeaponSystem } from './weapons/weaponSystem';
import { WorldWeapons } from './weapons/worldWeapons';
import { LevelBuilder } from './world/builder';
import { Course } from './world/course';
import { buildGym } from './world/gym';
import { buildTestRoom } from './world/testRoom';

const MAX_FRAME_DT = 0.1; // seconds; clamps the sim after a tab stall

async function boot(): Promise<void> {
  const canvas = document.getElementById('app') as HTMLCanvasElement;
  const el = (id: string): HTMLElement => document.getElementById(id)!;
  const hint = el('hint');
  const modeBadge = el('mode');
  const speedEl = el('speed');
  const ammoEl = el('ammo');
  const promptEl = el('prompt');
  const hitmarker = el('hitmarker');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(config.camera.baseFov, 1, 0.05, 200);

  const physics = await Physics.create();

  // The arena room is the default level; ?level=gym loads the movement gym. L switches.
  const isGym = new URLSearchParams(location.search).get('level') === 'gym';
  const builder = new LevelBuilder(scene, physics);
  const level = isGym ? buildGym(builder) : buildTestRoom(builder);
  const spawn = level.checkpoints[0];

  const pipeline = new RenderPipeline(canvas, scene, camera);
  const input = new Input(() => document.pointerLockElement === canvas);
  const rig = new CameraRig(camera, canvas, input);
  const player = new PlayerController(physics, config.player, spawn);
  const view = new PlayerView(player, config.camera, config.player.sprintSpeed);
  const course = new Course(level, player);
  const stats = new StatsOverlay(el('stats'));
  rig.yaw = spawn.yaw;

  // --- Weapons, loose guns and target dummies -----------------------------------
  const worldWeapons = new WorldWeapons(scene, physics);
  const dummies = new Dummies(scene, physics, worldWeapons);
  const effects = new WeaponEffects(scene);
  const viewmodel = new Viewmodel();
  pipeline.addOverlayScene(viewmodel.scene, viewmodel.camera);
  const fitViewmodel = (): void => viewmodel.resize(window.innerWidth / Math.max(1, window.innerHeight));
  fitViewmodel();
  window.addEventListener('resize', fitViewmodel);

  let hitstop = 0;
  let hitmarkerT = 0;
  const onHit = (killed: boolean): void => {
    hitmarkerT = killed ? 0.22 : 0.1;
    hitmarker.className = killed ? 'show kill' : 'show';
    if (killed) {
      hitstop = config.weapons.hitstop;
      rig.addShake(config.weapons.killShake);
    }
  };

  const weapons = new WeaponSystem({
    physics, camera, player, dummies, world: worldWeapons, effects, viewmodel,
    hooks: {
      recoil: (pitch, yaw) => rig.recoil(pitch, yaw),
      shake: (amount) => rig.addShake(amount),
      hit: onHit,
    },
  });
  if (level.startWeapon) weapons.give(level.startWeapon);
  for (const p of level.pickups ?? []) worldWeapons.spawn(WEAPONS[p.weapon], WEAPONS[p.weapon].ammo, p);
  for (const d of level.dummies ?? []) dummies.add(d);

  const faceSpawn = (p: { yaw: number }): void => {
    rig.yaw = p.yaw;
    rig.pitch = 0;
  };

  document.addEventListener('pointerlockchange', () => {
    hint.style.opacity = rig.locked ? '0' : '1';
  });

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    switch (e.code) {
      case 'F1':
        e.preventDefault();
        modeBadge.style.display = rig.toggleFly() ? 'block' : 'none';
        if (rig.flyEnabled) view.resetFov(camera);
        break;
      case 'F2':
        e.preventDefault();
        pipeline.fxaaEnabled = !pipeline.fxaaEnabled;
        break;
      case 'F3':
        e.preventDefault();
        stats.toggle();
        break;
      case 'KeyR':
        faceSpawn(course.respawn());
        break;
      case 'KeyT':
        faceSpawn(course.restart());
        break;
      case 'KeyL':
        location.search = isGym ? '' : '?level=gym';
        break;
      case 'KeyX':
        config.player.alwaysSprint = !config.player.alwaysSprint;
        break;
    }
  });

  // Reused every physics tick. While free-flying the player gets no input and just stands there.
  const playerInput: PlayerInput = {
    moveX: 0, moveZ: 0, yaw: 0, jumpPressed: false, jumpHeld: false, sprint: false, crouch: false,
  };
  const readPlayerInput = (): PlayerInput => {
    const fly = rig.flyEnabled;
    const shift = input.down('ShiftLeft') || input.down('ShiftRight');
    playerInput.moveX = fly ? 0 : input.axis('KeyA', 'KeyD');
    playerInput.moveZ = fly ? 0 : input.axis('KeyS', 'KeyW');
    playerInput.yaw = rig.yaw;
    playerInput.jumpPressed = fly ? false : input.consumeJump();
    playerInput.jumpHeld = !fly && input.down('Space');
    playerInput.sprint = shift !== config.player.alwaysSprint;
    playerInput.crouch = !fly && (input.down('KeyC') || input.down('ControlLeft') || input.down('ControlRight'));
    return playerInput;
  };

  const size = new THREE.Vector2();
  const look = { x: 0, y: 0 };
  let last = performance.now();
  let speedText = '';
  let ammoText = '';
  let promptText = '';

  const frame = (now: number): void => {
    const frameMs = now - last;
    last = now;
    const dt = Math.min(frameMs / 1000, MAX_FRAME_DT);

    // Hitstop: the world freezes for a few frames on a kill; the camera and HUD keep running.
    const frozen = hitstop > 0;
    hitstop = Math.max(0, hitstop - dt);
    const simDt = frozen ? 0 : dt;

    const alpha = physics.step(simDt, (h) => {
      player.fixedUpdate(h, readPlayerInput());
      const respawned = course.update(h);
      if (respawned) faceSpawn(respawned);
      worldWeapons.update(h, dummies, (killed) => {
        onHit(killed);
        rig.addShake(config.weapons.throwHitShake);
      });
    });

    rig.update(dt);
    rig.consumeLookDelta(look);
    if (rig.flyEnabled) {
      rig.roll = 0;
      rig.applyLook();
      rig.updateFly(dt);
      pipeline.setSpeedFx(0, 0);
    } else {
      view.update(dt, alpha, rig.yaw, camera);
      rig.roll = view.roll;
      rig.applyLook();
      pipeline.setSpeedFx(view.speedFx, now / 1000);
    }

    // Weapons run after the camera is placed so shots leave from exactly where you're looking.
    if (!frozen && !rig.flyEnabled) {
      weapons.update(dt, {
        fireHeld: input.fireHeld,
        firePressed: input.consumeFire(),
        throwPressed: input.consumeThrow(),
        pickupPressed: input.consumePickup(),
      });
    }
    dummies.update(simDt);
    effects.update(simDt);
    viewmodel.update(dt, look.x, look.y, player.horizontalSpeed, player.grounded && !player.sliding);

    pipeline.render();

    // --- HUD -----------------------------------------------------------------
    let s = `${player.horizontalSpeed.toFixed(1)} m/s`;
    if (course.timed && (course.running || course.finished)) {
      s += `  ·  ${course.time.toFixed(course.finished ? 2 : 1)} s${course.finished ? ' ✓' : ''}`;
    }
    if (s !== speedText) speedEl.textContent = speedText = s;

    const cur = weapons.current;
    const a = !cur ? 'UNARMED' : cur.ammo > 0 ? `${cur.def.name}  ${cur.ammo}` : `${cur.def.name}  EMPTY · throw it`;
    if (a !== ammoText) {
      ammoEl.textContent = ammoText = a;
      ammoEl.classList.toggle('empty', !cur || cur.ammo === 0);
    }
    const near = weapons.nearby;
    const p = near ? `E  ·  ${near.def.name} (${near.ammo})` : '';
    if (p !== promptText) {
      promptEl.textContent = promptText = p;
      promptEl.style.display = p ? 'block' : 'none';
    }
    if (hitmarkerT > 0) {
      hitmarkerT -= dt;
      if (hitmarkerT <= 0) hitmarker.className = '';
    }

    stats.update(frameMs, () => {
      pipeline.renderer.getDrawingBufferSize(size);
      return {
        calls: pipeline.renderer.info.render.calls,
        triangles: pipeline.renderer.info.render.triangles,
        width: size.x,
        height: size.y,
        bodies: physics.bodyCount,
        colliders: physics.colliderCount,
        fxaa: pipeline.fxaaEnabled,
        player: player.wallRunning ? 'wallrun' : player.sliding ? 'slide' : player.grounded ? (player.crouched ? 'crouch' : 'ground') : 'air',
      };
    });

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  if (import.meta.env.DEV) {
    // Console handle for poking at things during development.
    Object.assign(window, {
      __app: { scene, camera, rig, pipeline, physics, stats, player, input, config, course, view, weapons, dummies, worldWeapons },
    });
  }
}

boot().catch((err) => {
  console.error(err);
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
