import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

/** Physics and player movement tick. 120 Hz keeps input latency and interpolation lag low. */
export const FIXED_DT = 1 / 120;
const MAX_STEPS_PER_FRAME = 10;

// Collision groups (Rapier packs them as membership << 16 | filter).
const GROUP_PLAYER = 1 << 1;
const GROUP_PICKUP = 1 << 2;
const pack = (membership: number, filter: number): number => ((membership << 16) | filter) >>> 0;
/** The player capsule. */
export const PLAYER_GROUPS = pack(GROUP_PLAYER, 0xffff);
/** Loose guns: collide with everything except the player. */
export const PICKUP_GROUPS = pack(GROUP_PICKUP, 0xffff & ~GROUP_PLAYER);
/** Bullets: hit the world and enemies, pass through the player and loose guns. */
export const HITSCAN_GROUPS = pack(0xffff, 0xffff & ~(GROUP_PLAYER | GROUP_PICKUP));

interface DynamicEntry {
  body: RAPIER.RigidBody;
  object: THREE.Object3D;
}

export class Physics {
  readonly world: RAPIER.World;
  private readonly dynamics: DynamicEntry[] = [];
  private accumulator = 0;
  private readonly tags = new Map<number, Set<string>>();

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = FIXED_DT;
  }

  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics();
  }

  get bodyCount(): number {
    return this.world.bodies.len();
  }

  get colliderCount(): number {
    return this.world.colliders.len();
  }

  /** Mark a collider with a gameplay tag (e.g. 'wallrun'). */
  tag(collider: RAPIER.Collider, tag: string): void {
    let set = this.tags.get(collider.handle);
    if (!set) this.tags.set(collider.handle, (set = new Set()));
    set.add(tag);
  }

  hasTag(handle: number, tag: string): boolean {
    return this.tags.get(handle)?.has(tag) ?? false;
  }

  /** Static box collider matching a world-space transform. */
  addStaticBox(size: THREE.Vector3Like, position: THREE.Vector3Like, quaternion?: THREE.QuaternionLike): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setTranslation(
      position.x,
      position.y,
      position.z,
    );
    if (quaternion) desc.setRotation(quaternion);
    return this.world.createCollider(desc);
  }

  /** Static convex hull from local-space points (xyz triples). */
  addStaticHull(points: Float32Array, position: THREE.Vector3Like, quaternion?: THREE.QuaternionLike): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.convexHull(points);
    if (!desc) throw new Error('Convex hull generation failed');
    desc.setTranslation(position.x, position.y, position.z);
    if (quaternion) desc.setRotation(quaternion);
    return this.world.createCollider(desc);
  }

  /** Keep `object` in sync with a dynamic body after every step. */
  track(body: RAPIER.RigidBody, object: THREE.Object3D): void {
    this.dynamics.push({ body, object });
  }

  untrack(body: RAPIER.RigidBody): void {
    const i = this.dynamics.findIndex((d) => d.body === body);
    if (i >= 0) this.dynamics.splice(i, 1);
  }

  /** Dynamic box whose transform drives `object` every step. */
  addDynamicBox(object: THREE.Object3D, size: THREE.Vector3Like, density = 1): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(object.position.x, object.position.y, object.position.z)
        .setRotation(object.quaternion),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setDensity(density).setRestitution(0.2),
      body,
    );
    this.dynamics.push({ body, object });
    return body;
  }

  /**
   * Advance with a fixed timestep. `beforeStep` runs ahead of every sub-step
   * (this is where the player controller ticks). Returns the interpolation
   * factor 0..1: how far the current frame sits past the latest sub-step.
   */
  step(dt: number, beforeStep?: (dt: number) => void): number {
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      beforeStep?.(FIXED_DT);
      this.world.step();
      this.accumulator -= FIXED_DT;
      steps++;
    }
    // Drop the backlog after a long stall instead of spiralling.
    if (this.accumulator >= FIXED_DT) this.accumulator = 0;

    if (steps > 0) {
      for (const { body, object } of this.dynamics) {
        const t = body.translation();
        const r = body.rotation();
        object.position.set(t.x, t.y, t.z);
        object.quaternion.set(r.x, r.y, r.z, r.w);
      }
    }
    return this.accumulator / FIXED_DT;
  }
}
