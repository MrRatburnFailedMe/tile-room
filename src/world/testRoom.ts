import * as THREE from 'three';
import { CYAN, LevelBuilder, ORANGE, type Level } from './builder';

const ROOM = 40; // floor edge, metres
const WALL_H = 8;
const WALL_T = 0.5;

/** The step 1/2 sandbox: an open 40×40 room with assorted props. Load with ?level=room. */
export function buildTestRoom(b: LevelBuilder): Level {
  const { floor, wall, prop, glowGrid, light, orangeTrim } = b.mats;
  const { scene, physics } = b;

  b.lighting({ sunDir: [14, 18, 10], center: [0, 0, 0], halfWidth: 30, halfHeight: 30 });

  // --- Shell: 40×40 floor, 8 m walls ---------------------------------------
  b.box([ROOM, 1, ROOM], [0, -0.5, 0], floor);
  const half = ROOM / 2 + WALL_T / 2;
  const span = ROOM + WALL_T * 2;
  b.box([span, WALL_H, WALL_T], [0, WALL_H / 2, -half], wall); // north
  b.box([span, WALL_H, WALL_T], [0, WALL_H / 2, half], wall); // south
  b.box([WALL_T, WALL_H, ROOM], [-half, WALL_H / 2, 0], wall); // west
  b.box([WALL_T, WALL_H, ROOM], [half, WALL_H / 2, 0], wall); // east

  // --- Props: boxes and ramps (edges on whole metres so seams meet corners) -
  b.box([2, 2, 2], [-5, 1, -8], prop);
  b.box([1, 1, 1], [-3.5, 0.5, -8.5], prop);
  b.box([2, 4, 2], [3, 2, -13], prop);
  b.box([2, 2, 2], [-11, 1, -13], glowGrid); // emissive-edge variant

  b.box([6, 2, 6], [10, 1, -10], prop); // platform
  b.ramp(4, 2, 8, [10, 0, -3]); // long ramp up to the platform

  b.box([4, 2, 4], [-12, 1, 6], prop); // second platform
  b.ramp(3, 2, 4, [-8, 0, 6], Math.PI / 2); // steeper ramp, rising toward -x

  // --- Movement test pieces ----------------------------------------------------
  b.ramp(4, 4, 2, [15, 0, 6]); // 63° wedge: too steep to stand on, you slide off

  b.box([4, 0.5, 4], [-6, 2.65, 10], prop); // low ceiling (2.4 m) to bonk a jump against
  b.box([0.5, 2.4, 4], [-8.25, 1.2, 10], prop);

  b.box([4, 1.75, 1], [6, 2.125, 8], prop); // 1.25 m gap: only a slide/crouch fits under
  b.box([0.5, 1.25, 1], [3.75, 0.625, 8], prop);
  b.box([0.5, 1.25, 1], [8.25, 0.625, 8], prop);

  // --- Glass pane -----------------------------------------------------------
  const glass = b.box(
    [8, 3.5, 0.12],
    [0, 1.75, 0],
    new THREE.MeshPhysicalMaterial({
      color: CYAN,
      transparent: true,
      opacity: 0.22,
      roughness: 0.05,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    { shadows: false },
  );
  glass.renderOrder = 1;
  glass.add(
    new THREE.LineSegments(
      new THREE.EdgesGeometry(glass.geometry),
      new THREE.LineBasicMaterial({ color: new THREE.Color(CYAN).multiplyScalar(1.6) }),
    ),
  );

  // --- Orange-trimmed emissive strip on the north wall -----------------------
  const stripZ = -ROOM / 2 + 0.05;
  const stripY = 4;
  const stripLen = 16;
  const decor = { collider: false, shadows: false };
  b.box([stripLen, 0.3, 0.1], [0, stripY, stripZ], light, decor);
  b.box([stripLen + 0.3, 0.08, 0.16], [0, stripY + 0.19, stripZ + 0.03], orangeTrim, decor);
  b.box([stripLen + 0.3, 0.08, 0.16], [0, stripY - 0.19, stripZ + 0.03], orangeTrim, decor);
  b.box([0.08, 0.3, 0.16], [-(stripLen / 2 + 0.11), stripY, stripZ + 0.03], orangeTrim, decor);
  b.box([0.08, 0.3, 0.16], [stripLen / 2 + 0.11, stripY, stripZ + 0.03], orangeTrim, decor);

  // --- A few dynamic cubes so the Rapier loop is visibly alive ---------------
  const cubeGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
  const cubeMat = new THREE.MeshStandardMaterial({ color: ORANGE, roughness: 0.6 });
  for (let i = 0; i < 4; i++) {
    const cube = new THREE.Mesh(cubeGeo, cubeMat);
    cube.position.set(9.2 + i * 0.5, 4 + i * 1.2, -2 - i * 0.6);
    cube.rotation.set(0.3 * i, 0.5 * i, 0.2);
    cube.castShadow = true;
    cube.receiveShadow = true;
    scene.add(cube);
    physics.addDynamicBox(cube, { x: 0.6, y: 0.6, z: 0.6 });
  }

  return {
    name: 'room',
    checkpoints: [{ x: 0, y: 0, z: 14, yaw: 0 }],
    killY: -20,
    startWeapon: 'pistol',
    pickups: [
      { weapon: 'smg', x: -2, y: 0.3, z: 11 },
      { weapon: 'shotgun', x: 2, y: 0.3, z: 11 },
    ],
    dummies: [
      { x: -3, y: 0, z: 6, yaw: Math.PI, weapon: 'smg' },
      { x: 4, y: 0, z: 4, yaw: Math.PI, weapon: 'shotgun' },
      { x: 0, y: 0, z: -6, yaw: Math.PI, weapon: 'pistol' },
      { x: 10, y: 2, z: -10, yaw: Math.PI, weapon: 'smg' },
      { x: -12, y: 2, z: 6, yaw: Math.PI / 2, weapon: 'shotgun' },
    ],
  };
}
