import * as THREE from 'three';
import type { Physics } from '../physics/physics';
import { createTileGridMaterial } from '../render/tileGridMaterial';
import type { DummySpec } from '../enemies/dummies';
import type { WeaponId } from '../weapons/weaponDefs';

export const ORANGE = 0xff7a1a;
export const CYAN = 0x35e0ff;

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  /** View yaw on (re)spawn; 0 faces -Z. */
  yaw: number;
}

export interface Level {
  name: string;
  /** Checkpoints in course order; the first is the spawn. */
  checkpoints: SpawnPoint[];
  /** Falling below this respawns at the current checkpoint. */
  killY: number;
  /** Optional timed course along -Z: the clock runs from crossing startZ to crossing finishZ. */
  startZ?: number;
  finishZ?: number;
  /** Gun the player spawns holding. */
  startWeapon?: WeaponId;
  /** Guns lying on the floor. */
  pickups?: { weapon: WeaponId; x: number; y: number; z: number }[];
  /** Target dummies. */
  dummies?: DummySpec[];
}

type V3 = [number, number, number];

interface BoxOptions {
  collider?: boolean;
  shadows?: boolean;
  /** Gameplay tag for the collider, e.g. 'wallrun'. */
  tag?: string;
}

/** Right-angle ramp: footprint w × l, height 0 at +z rising to h at -z. Also returns hull points. */
function createWedge(w: number, h: number, l: number): { geometry: THREE.BufferGeometry; points: Float32Array } {
  const x = w / 2;
  const z = l / 2;
  const A = [-x, 0, z];
  const B = [x, 0, z];
  const C = [x, 0, -z];
  const D = [-x, 0, -z];
  const E = [-x, h, -z];
  const F = [x, h, -z];
  // prettier-ignore
  const tris = [
    A, B, F,  A, F, E, // slope
    D, E, F,  D, F, C, // back
    A, D, C,  A, C, B, // bottom
    A, E, D,           // left
    B, C, F,           // right
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  geometry.computeVertexNormals();
  return { geometry, points: new Float32Array([A, B, C, D, E, F].flat()) };
}

/** Shared materials and geometry helpers for building levels (visual mesh + physics collider together). */
export class LevelBuilder {
  readonly mats = {
    floor: createTileGridMaterial({ baseColor: 0xe9ecef, lineColor: 0xa9b1bb, lineWidth: 0.025 }),
    wall: createTileGridMaterial({ baseColor: 0xf4f6f8, lineColor: 0xb8c0c9, lineWidth: 0.02 }),
    prop: createTileGridMaterial({ baseColor: 0xf7f8fa, lineColor: 0xb0b8c2, lineWidth: 0.02 }),
    /** Wall-runnable surface: white tiles with glowing orange seams. */
    wallrun: createTileGridMaterial({
      baseColor: 0xf6f1ec,
      lineColor: ORANGE,
      lineWidth: 0.03,
      emissiveEdge: ORANGE,
      emissiveEdgeIntensity: 0.9,
    }),
    glowGrid: createTileGridMaterial({
      baseColor: 0x20252c,
      lineColor: CYAN,
      tileSize: 0.5,
      lineWidth: 0.02,
      emissiveEdge: CYAN,
      emissiveEdgeIntensity: 2.5,
      roughness: 0.5,
    }),
    light: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e6, emissiveIntensity: 3.2 }),
    orangeTrim: new THREE.MeshStandardMaterial({ color: ORANGE, emissive: ORANGE, emissiveIntensity: 1.6, roughness: 0.4 }),
    cyanTrim: new THREE.MeshStandardMaterial({ color: CYAN, emissive: CYAN, emissiveIntensity: 1.4, roughness: 0.4 }),
  };

  constructor(
    readonly scene: THREE.Scene,
    readonly physics: Physics,
  ) {}

  /** Sky fill + one shadow-casting sun whose shadow frustum covers the given extents around `center`. */
  lighting(opts: { sunDir: V3; center: V3; halfWidth: number; halfHeight: number; mapSize?: number }): void {
    this.scene.background = new THREE.Color(0xdfe6ee);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd8dde4, 1.9));

    const dist = 100;
    const dir = new THREE.Vector3(...opts.sunDir).normalize();
    const sun = new THREE.DirectionalLight(0xfff6ea, 2.0);
    sun.target.position.set(...opts.center);
    sun.position.copy(sun.target.position).addScaledVector(dir, dist);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(opts.mapSize ?? 2048);
    const sc = sun.shadow.camera;
    sc.left = -opts.halfWidth;
    sc.right = opts.halfWidth;
    sc.top = opts.halfHeight;
    sc.bottom = -opts.halfHeight;
    sc.near = 1;
    sc.far = dist * 2;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.05;
    this.scene.add(sun, sun.target);
  }

  box(size: V3, pos: V3, material: THREE.Material, opts: BoxOptions = {}): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...pos);
    const shadows = opts.shadows ?? true;
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    this.scene.add(mesh);
    if (opts.collider ?? true) {
      const collider = this.physics.addStaticBox({ x: size[0], y: size[1], z: size[2] }, mesh.position);
      if (opts.tag) this.physics.tag(collider, opts.tag);
    }
    return mesh;
  }

  /** Box given by its min/max corners instead of size + centre. */
  span(min: V3, max: V3, material: THREE.Material, opts: BoxOptions = {}): THREE.Mesh {
    return this.box(
      [Math.abs(max[0] - min[0]), Math.abs(max[1] - min[1]), Math.abs(max[2] - min[2])],
      [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
      material,
      opts,
    );
  }

  /** Decorative emissive piece: no collider, no shadows. */
  trim(min: V3, max: V3, material: THREE.Material): THREE.Mesh {
    return this.span(min, max, material, { collider: false, shadows: false });
  }

  /** Solid wedge. Unrotated it is level at +z and rises to `h` at -z; `pos` is the centre of its base. */
  ramp(w: number, h: number, l: number, pos: V3, rotY = 0, material: THREE.Material = this.mats.prop): THREE.Mesh {
    const { geometry, points } = createWedge(w, h, l);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...pos);
    mesh.rotation.y = rotY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.physics.addStaticHull(points, mesh.position, mesh.quaternion);
    return mesh;
  }
}
