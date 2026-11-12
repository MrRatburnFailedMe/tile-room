import RAPIER from '@dimforge/rapier3d-compat';
import type { PlayerConfig } from '../config';
import { PLAYER_GROUPS, type Physics } from '../physics/physics';

export interface PlayerInput {
  /** Strafe: -1 left … +1 right. */
  moveX: number;
  /** Forward: -1 back … +1 forward. */
  moveZ: number;
  /** View yaw in radians (0 looks down -Z, positive turns left). */
  yaw: number;
  /** True only on the tick the jump key went down. */
  jumpPressed: boolean;
  jumpHeld: boolean;
  sprint: boolean;
  crouch: boolean;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const DOWN = { x: 0, y: -1, z: 0 };
/** Loose props are ignored by the sweeps; the kinematic capsule simply shoves them aside. */
const QUERY_FLAGS = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC;
/** Headroom test uses a slightly thinner capsule so merely touching a wall never blocks standing up. */
const PROBE_SHRINK = 0.015;
const GROUND_PROBE = 0.03;
const MAX_BUMPS = 4;
const KILL_Y = -30;

/**
 * First-person movement: a kinematic Rapier capsule moved by a sweep-and-slide
 * built on Rapier shape casts.
 *
 * Velocity is owned here (Quake/Source-style accelerate + friction). Each tick
 * the capsule is swept along the velocity, stopped `skin` short of whatever it
 * hits, and the leftover motion is slid along the surface. Velocity is then
 * clipped against every non-walkable surface that was hit, which is what stops
 * the player sticking to walls, ceilings and steep slopes.
 *
 * Runs on the fixed physics tick. `prevFeet`/`feet` are for render interpolation.
 */
export class PlayerController {
  readonly velocity: Vec3 = { x: 0, y: 0, z: 0 };
  /** Bottom of the capsule after the latest tick. */
  readonly feet: Vec3;
  /** Bottom of the capsule before the latest tick. */
  readonly prevFeet: Vec3;
  readonly groundNormal: Vec3 = { x: 0, y: 1, z: 0 };

  grounded = false;
  sliding = false;
  crouched = false;
  wallRunning = false;
  /** Horizontal normal of the wall being run on (points from the wall toward the player). */
  readonly wallNormal = { x: 0, z: 0 };
  /** Downward speed of the most recent landing; the camera reads and clears it. */
  landingImpact = 0;

  private readonly world: RAPIER.World;
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;

  private readonly standShape: RAPIER.Capsule;
  private readonly crouchShape: RAPIER.Capsule;
  private readonly standProbe: RAPIER.Capsule;
  private readonly standHalf: number;
  private readonly crouchHalf: number;
  private readonly minGroundY: number;

  private jumpBufferT = 0;
  private coyoteT = 0;
  private slideCooldownT = 0;
  private hasJumped = false;
  private wallRunT = 0;
  private wallHandle = -1;
  /** Wall most recently run on; it can't be re-attached until you land or use another wall. */
  private lastWallHandle = -1;
  private wallCoyoteT = 0;
  /** Set when the latest move touched a too-steep slope; holds its horizontal normal. */
  private steepContact = false;
  private steepX = 0;
  private steepZ = 0;

  private readonly spawn: Vec3;
  private readonly center: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly delta: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly dir: Vec3 = { x: 0, y: 0, z: 0 };
  /** Surfaces hit by the latest slide, as flat xyz triples. */
  private readonly planes = new Float64Array(MAX_BUMPS * 3);
  private planeCount = 0;
  private readonly planeHandles = new Int32Array(MAX_BUMPS);

  constructor(
    private readonly physics: Physics,
    private readonly cfg: PlayerConfig,
    spawnFeet: Vec3,
  ) {
    this.world = physics.world;
    const r = cfg.radius;
    this.standHalf = cfg.height / 2 - r;
    this.crouchHalf = Math.max(cfg.crouchHeight / 2 - r, 0.01);
    this.standShape = new RAPIER.Capsule(this.standHalf, r);
    this.crouchShape = new RAPIER.Capsule(this.crouchHalf, r);
    this.standProbe = new RAPIER.Capsule(this.standHalf, r - PROBE_SHRINK);
    this.minGroundY = Math.cos((cfg.maxSlopeDeg * Math.PI) / 180);

    this.spawn = { x: spawnFeet.x, y: spawnFeet.y + cfg.skin, z: spawnFeet.z };
    this.feet = { ...this.spawn };
    this.prevFeet = { ...this.spawn };

    const c = this.computeCenter();
    this.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(c.x, c.y, c.z),
    );
    this.collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(this.standHalf, r).setCollisionGroups(PLAYER_GROUPS),
      this.body,
    );
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** Current total capsule height. */
  get currentHeight(): number {
    return this.crouched ? this.cfg.crouchHeight : this.cfg.height;
  }

  teleport(feet: Vec3): void {
    this.feet.x = this.prevFeet.x = feet.x;
    this.feet.y = this.prevFeet.y = feet.y;
    this.feet.z = this.prevFeet.z = feet.z;
    this.velocity.x = this.velocity.y = this.velocity.z = 0;
    this.grounded = false;
    this.sliding = false;
    this.wallRunning = false;
    this.lastWallHandle = -1;
    this.wallCoyoteT = 0;
    this.jumpBufferT = 0;
    this.body.setTranslation(this.computeCenter(), true);
  }

  fixedUpdate(dt: number, input: PlayerInput): void {
    const cfg = this.cfg;
    const v = this.velocity;

    if (this.feet.y < KILL_Y) this.teleport(this.spawn);

    this.prevFeet.x = this.feet.x;
    this.prevFeet.y = this.feet.y;
    this.prevFeet.z = this.feet.z;

    // --- Timers ---------------------------------------------------------
    if (input.jumpPressed || (cfg.autoHop && input.jumpHeld)) this.jumpBufferT = cfg.jumpBuffer;
    else this.jumpBufferT = Math.max(0, this.jumpBufferT - dt);
    this.slideCooldownT = Math.max(0, this.slideCooldownT - dt);

    // --- Crouch (capsule shrinks from the top; feet stay put) --------------
    let crouchStarted = false;
    if (input.crouch && !this.crouched) {
      this.setCrouched(true);
      crouchStarted = true;
    } else if (!input.crouch && this.crouched && this.canStand()) {
      this.setCrouched(false);
    }

    // --- Ground state -----------------------------------------------------
    // Only walkable surfaces count, and never while moving upward, so a jump
    // can't be cancelled by the ground it just left and steep slopes are "air".
    const wasGrounded = this.grounded;
    this.grounded = this.probeGround() && v.y <= 1e-3;
    let landed = false;
    if (this.grounded) {
      if (!wasGrounded) {
        landed = true;
        this.landingImpact = Math.max(this.landingImpact, -v.y);
      }
      v.y = 0;
      this.coyoteT = cfg.coyoteTime;
      this.hasJumped = false;
    } else {
      this.coyoteT = Math.max(0, this.coyoteT - dt);
    }

    // --- Wall-run state ---------------------------------------------------------
    this.wallCoyoteT = Math.max(0, this.wallCoyoteT - dt);
    if (this.grounded) {
      this.wallRunning = false;
      this.lastWallHandle = -1;
      this.wallCoyoteT = 0;
    } else if (this.wallRunning) {
      this.updateWallRun(dt, input.crouch);
    } else {
      this.tryStartWallRun();
    }

    // --- Slide state --------------------------------------------------------
    const speed = this.horizontalSpeed;
    if (this.sliding && (!this.crouched || !this.grounded || speed < cfg.slide.stopSpeed)) {
      this.sliding = false;
    }
    if (!this.sliding && this.crouched && this.grounded && (crouchStarted || landed) && speed >= cfg.slide.minSpeed) {
      this.sliding = true;
      if (this.slideCooldownT <= 0 && speed < cfg.slide.boostMaxSpeed) {
        const k = Math.min(speed * (1 + cfg.slide.boost), cfg.slide.boostMaxSpeed) / speed;
        v.x *= k;
        v.z *= k;
        this.slideCooldownT = cfg.slide.boostCooldown;
      }
    }

    // --- Jump (buffered press + coyote time) ---------------------------------
    // Decided before friction, so a hop timed on landing keeps all its speed.
    if (this.jumpBufferT > 0 && (this.grounded || (this.coyoteT > 0 && !this.hasJumped))) {
      v.y = cfg.jumpSpeed;
      this.grounded = false;
      this.sliding = false;
      this.hasJumped = true;
      this.jumpBufferT = 0;
      this.coyoteT = 0;
    } else if (this.jumpBufferT > 0 && !this.grounded && (this.wallRunning || this.wallCoyoteT > 0)) {
      this.wallJump();
    }

    // --- Wish direction --------------------------------------------------------
    const sin = Math.sin(input.yaw);
    const cos = Math.cos(input.yaw);
    let wx = input.moveX * cos - input.moveZ * sin;
    let wz = -input.moveX * sin - input.moveZ * cos;
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-6) {
      wx /= wl;
      wz /= wl;
    }
    // Touching a too-steep slope: ignore the part of the input that pushes into it,
    // otherwise air control fights gravity and you can hang there.
    if (this.steepContact && wl > 1e-6) {
      const into = wx * this.steepX + wz * this.steepZ;
      if (into < 0) {
        wx -= this.steepX * into;
        wz -= this.steepZ * into;
        const l = Math.hypot(wx, wz);
        if (l > 1e-6) {
          wx /= l;
          wz /= l;
        } else {
          wx = wz = 0;
        }
      }
    }
    const hasWish = wl > 1e-6 && (wx !== 0 || wz !== 0);
    const wishSpeed = this.crouched && this.grounded ? cfg.crouchSpeed : input.sprint ? cfg.sprintSpeed : cfg.walkSpeed;

    // --- Accelerate ----------------------------------------------------------------
    if (this.grounded) {
      if (this.sliding) {
        this.applyFriction(cfg.slide.friction, 0, dt);
        // Gravity along the slope: slides speed up downhill and die uphill.
        const n = this.groundNormal;
        v.x += cfg.gravity * n.y * n.x * dt;
        v.z += cfg.gravity * n.y * n.z * dt;
        // Steering only, same rule as air strafing.
        if (hasWish) this.airAccelerate(wx, wz, cfg.sprintSpeed, dt);
      } else {
        this.applyFriction(cfg.friction, cfg.stopSpeed, dt);
        if (hasWish) this.accelerate(wx, wz, wishSpeed, cfg.groundAccel, dt);
      }
    } else if (this.wallRunning) {
      this.wallRunMove(dt, wx, wz, hasWish);
    } else {
      if (hasWish) this.airAccelerate(wx, wz, wishSpeed, dt);
      v.y = Math.max(v.y - cfg.gravity * dt, -cfg.terminalSpeed);
    }

    // --- Move and slide -------------------------------------------------------------
    const d = this.delta;
    d.x = v.x * dt;
    d.z = v.z * dt;
    if (this.grounded) {
      // Follow the ground plane so horizontal speed is the same on slopes as on the flat.
      const n = this.groundNormal;
      d.y = -(n.x * d.x + n.z * d.z) / n.y;
      this.groundMove(d);
    } else {
      d.y = v.y * dt;
      this.slide(this.feet, d, false);
    }
    this.clipVelocity();

    this.body.setNextKinematicTranslation(this.computeCenter());
  }

  // --- Wall-run ---------------------------------------------------------------------

  /**
   * Attach to a wall tagged for wall-running if we are airborne, it is within
   * reach on either side (or we just hit it), and we are moving roughly along it.
   */
  private tryStartWallRun(): void {
    const w = this.cfg.wallrun;
    const v = this.velocity;
    const sp = Math.hypot(v.x, v.z);
    if (sp < w.minSpeed) return;
    const dx = v.x / sp, dz = v.z / sp;

    let bestToi = Infinity, bnx = 0, bnz = 0, bh = -1, bAlong = 0;
    const consider = (nx: number, ny: number, nz: number, handle: number, toi: number): void => {
      if (Math.abs(ny) > 0.2 || handle === this.lastWallHandle || toi >= bestToi) return;
      if (!this.physics.hasTag(handle, w.tag)) return;
      const h = Math.hypot(nx, nz);
      nx /= h;
      nz /= h;
      const into = -(dx * nx + dz * nz); // share of our speed heading into the wall
      const along = Math.sqrt(Math.max(0, 1 - into * into));
      if (into < -0.3 || along * sp < w.minSpeed || into > along * w.maxApproach) return;
      bestToi = toi; bnx = nx; bnz = nz; bh = handle; bAlong = along * sp;
    };

    for (let i = 0; i < this.planeCount; i++) {
      consider(this.planes[i * 3], this.planes[i * 3 + 1], this.planes[i * 3 + 2], this.planeHandles[i], 0);
    }
    const dir = this.dir;
    for (const side of [1, -1]) {
      dir.x = dz * side; dir.y = 0; dir.z = -dx * side;
      const hit = this.cast(dir, this.cfg.skin + w.reach);
      if (hit) consider(hit.normal1.x, hit.normal1.y, hit.normal1.z, hit.collider.handle, hit.time_of_impact);
    }
    if (bh < 0) return;

    this.wallRunning = true;
    this.sliding = false;
    this.wallNormal.x = bnx;
    this.wallNormal.z = bnz;
    this.wallHandle = bh;
    this.wallRunT = 0;

    // Turn the approach into speed along the wall (up to wall-run speed), and tame the vertical.
    let tx = -bnz, tz = bnx;
    if (v.x * tx + v.z * tz < 0) { tx = -tx; tz = -tz; }
    const along = Math.max(bAlong, Math.min(sp, w.speed));
    v.x = tx * along;
    v.z = tz * along;
    v.y = Math.min(Math.max(v.y, -w.attachMaxFall), w.attachMaxRise);
  }

  /** Per-tick checks while wall-running: is the wall still there, and should the run end? */
  private updateWallRun(dt: number, crouch: boolean): void {
    const w = this.cfg.wallrun;
    const n = this.wallNormal;
    const v = this.velocity;
    this.wallRunT += dt;

    const dir = this.dir;
    dir.x = -n.x; dir.y = 0; dir.z = -n.z;
    const hit = this.cast(dir, this.cfg.skin + w.reach + 0.1);
    let valid = false;
    if (hit && Math.abs(hit.normal1.y) <= 0.2 && this.physics.hasTag(hit.collider.handle, w.tag)) {
      const h = Math.hypot(hit.normal1.x, hit.normal1.z);
      n.x = hit.normal1.x / h;
      n.z = hit.normal1.z / h;
      this.wallHandle = hit.collider.handle;
      valid = true;
    }
    const along = Math.abs(v.x * -n.z + v.z * n.x);
    if (!valid || crouch || this.wallRunT >= w.maxTime || along < w.minSpeed) {
      this.wallRunning = false;
      this.lastWallHandle = this.wallHandle;
      this.wallCoyoteT = w.coyoteTime;
    }
  }

  /** Velocity while on the wall: run along it, press lightly into it, fall at reduced gravity. */
  private wallRunMove(dt: number, wx: number, wz: number, hasWish: boolean): void {
    const w = this.cfg.wallrun;
    const n = this.wallNormal;
    const v = this.velocity;
    let tx = -n.z, tz = n.x;
    let along = v.x * tx + v.z * tz;
    if (along < 0) { tx = -tx; tz = -tz; along = -along; }

    const push = hasWish ? wx * tx + wz * tz : 0;
    if (push > 0) {
      if (along < w.speed) along = Math.min(along + w.accel * push * dt, w.speed);
    } else {
      along = Math.max(0, along - w.drag * dt);
    }
    v.x = tx * along - n.x * w.stick;
    v.z = tz * along - n.z * w.stick;
    v.y = Math.max(v.y - this.cfg.gravity * w.gravityScale * dt, -w.maxFallSpeed);
  }

  /** Kick off the wall: along-wall speed is kept, plus a push along the normal and upward. */
  private wallJump(): void {
    const w = this.cfg.wallrun;
    const n = this.wallNormal;
    const v = this.velocity;
    const tx = -n.z, tz = n.x;
    const along = v.x * tx + v.z * tz;
    v.x = tx * along + n.x * w.jumpPush;
    v.z = tz * along + n.z * w.jumpPush;
    v.y = w.jumpUp;
    this.wallRunning = false;
    this.lastWallHandle = this.wallHandle;
    this.wallCoyoteT = 0;
    this.jumpBufferT = 0;
    this.coyoteT = 0;
    this.hasJumped = true;
  }

  /** Slide along the ground, then stay glued to it over ramp crests and small drops. */
  private groundMove(delta: Vec3): void {
    const cfg = this.cfg;
    this.slide(this.feet, delta, true);
    // Keep exactly `skin` above walkable ground.
    const hit = this.cast(DOWN, cfg.snapDistance + cfg.skin);
    if (hit && hit.normal1.y >= this.minGroundY) this.feet.y -= hit.time_of_impact - cfg.skin;
  }

  /**
   * Sweep the capsule along `delta`, stopping `skin` short of anything solid and
   * sliding the leftover motion along it (up to MAX_BUMPS surfaces). Moves `pos`
   * (which must be this.feet) and records the surfaces hit in `planes`.
   */
  private slide(pos: Vec3, delta: Vec3, groundMove: boolean): void {
    const skin = this.cfg.skin;
    const dir = this.dir;
    const planes = this.planes;
    let rx = delta.x, ry = delta.y, rz = delta.z;
    this.planeCount = 0;

    for (let bump = 0; bump < MAX_BUMPS; bump++) {
      const len = Math.hypot(rx, ry, rz);
      if (len < 1e-7) break;
      dir.x = rx / len;
      dir.y = ry / len;
      dir.z = rz / len;

      const hit = this.cast(dir, len + skin * 4);
      if (!hit) {
        pos.x += rx; pos.y += ry; pos.z += rz;
        break;
      }
      const nx = hit.normal1.x, ny = hit.normal1.y, nz = hit.normal1.z;
      const approach = -(dir.x * nx + dir.y * ny + dir.z * nz);
      // Distance we can travel and still be `skin` away, measured along the surface normal.
      const allowed = approach > 1e-4 ? hit.time_of_impact - skin / approach : len;
      if (allowed >= len) {
        pos.x += rx; pos.y += ry; pos.z += rz;
        break;
      }
      if (allowed > 0) {
        pos.x += dir.x * allowed; pos.y += dir.y * allowed; pos.z += dir.z * allowed;
        rx -= dir.x * allowed; ry -= dir.y * allowed; rz -= dir.z * allowed;
      }

      this.planeHandles[this.planeCount] = hit.collider.handle;
      const i = this.planeCount++ * 3;
      planes[i] = nx; planes[i + 1] = ny; planes[i + 2] = nz;

      const bx = rx, by = ry, bz = rz; // leftover before clipping, for the crease case
      const c = this.clip(rx, ry, rz, nx, ny, nz, groundMove, false);
      rx = c.x; ry = c.y; rz = c.z;

      // If the clipped motion heads back into a surface hit earlier, slide along the crease between them.
      for (let j = 0; j < this.planeCount - 1; j++) {
        const px = planes[j * 3], py = planes[j * 3 + 1], pz = planes[j * 3 + 2];
        if (rx * px + ry * py + rz * pz >= -1e-7) continue;
        let cx = ny * pz - nz * py, cy = nz * px - nx * pz, cz = nx * py - ny * px;
        const cl = Math.hypot(cx, cy, cz);
        if (cl < 1e-6 || this.planeCount > 2) {
          rx = ry = rz = 0;
        } else {
          cx /= cl; cy /= cl; cz /= cl;
          const along = bx * cx + by * cy + bz * cz;
          rx = cx * along; ry = cy * along; rz = cz * along;
        }
        break;
      }
    }
  }

  private readonly clipOut: Vec3 = { x: 0, y: 0, z: 0 };

  /**
   * Remove the part of a vector that points into a surface with normal n.
   *  - Walkable ground: plain projection for motion; velocity is left alone
   *    (landing is handled by the ground probe, and we don't want ramps eating speed).
   *  - Too-steep slope: horizontally it behaves like a wall, so pushing into it
   *    never converts into climbing; in the air the remainder is projected onto
   *    the slope so gravity slides you down it.
   *  - Walls and ceilings: plain projection.
   */
  private clip(x: number, y: number, z: number, nx: number, ny: number, nz: number, groundMove: boolean, isVelocity: boolean): Vec3 {
    const out = this.clipOut;
    out.x = x; out.y = y; out.z = z;
    const walkable = ny >= this.minGroundY;
    if (walkable && isVelocity) return out;

    if (!walkable && ny > 0) {
      const h = Math.hypot(nx, nz);
      if (h > 1e-6) {
        const hx = nx / h, hz = nz / h;
        const into = out.x * hx + out.z * hz;
        if (into < 0) {
          out.x -= hx * into;
          out.z -= hz * into;
        }
      }
      if (groundMove) return out;
    }

    const into = out.x * nx + out.y * ny + out.z * nz;
    if (into < 0) {
      out.x -= nx * into;
      out.y -= ny * into;
      out.z -= nz * into;
    }
    return out;
  }

  /** Clip velocity against every surface the latest slide hit (two passes settles corners). */
  private clipVelocity(): void {
    const v = this.velocity;
    const planes = this.planes;
    this.steepContact = false;
    for (let i = 0; i < this.planeCount; i++) {
      const nx = planes[i * 3], ny = planes[i * 3 + 1], nz = planes[i * 3 + 2];
      const h = Math.hypot(nx, nz);
      if (ny > 0.05 && ny < this.minGroundY && h > 1e-6) {
        this.steepContact = true;
        this.steepX = nx / h;
        this.steepZ = nz / h;
      }
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.planeCount; i++) {
        const c = this.clip(v.x, v.y, v.z, planes[i * 3], planes[i * 3 + 1], planes[i * 3 + 2], this.grounded, true);
        v.x = c.x; v.y = c.y; v.z = c.z;
      }
    }
  }

  private cast(dir: Vec3, distance: number): RAPIER.ColliderShapeCastHit | null {
    return this.world.castShape(
      this.computeCenter(), IDENTITY, dir,
      this.crouched ? this.crouchShape : this.standShape,
      0, distance, false, QUERY_FLAGS, undefined, this.collider,
    );
  }

  private applyFriction(friction: number, stopSpeed: number, dt: number): void {
    const v = this.velocity;
    const speed = Math.hypot(v.x, v.z);
    if (speed < 1e-4) {
      v.x = v.z = 0;
      return;
    }
    const drop = Math.max(speed, stopSpeed) * friction * dt;
    const k = Math.max(speed - drop, 0) / speed;
    v.x *= k;
    v.z *= k;
  }

  private accelerate(wx: number, wz: number, wishSpeed: number, accel: number, dt: number): void {
    const v = this.velocity;
    const add = wishSpeed - (v.x * wx + v.z * wz);
    if (add <= 0) return;
    const before = Math.hypot(v.x, v.z);
    const a = Math.min(accel * wishSpeed * dt, add);
    v.x += wx * a;
    v.z += wz * a;
    // Without this, pushing diagonally into a wall out-runs the wish speed
    // (the wall eats the sideways part, so the accelerate never "arrives").
    const after = Math.hypot(v.x, v.z);
    const cap = Math.max(before, wishSpeed);
    if (after > cap) {
      const k = cap / after;
      v.x *= k;
      v.z *= k;
    }
  }

  /**
   * Quake air acceleration: only the velocity component along the wish direction
   * is limited (to a small wish speed), so turning into a strafe adds speed.
   * The gain is capped at airStrafeSpeedCap; speed already above the cap is kept.
   */
  private airAccelerate(wx: number, wz: number, wishSpeed: number, dt: number): void {
    const cfg = this.cfg;
    const v = this.velocity;
    const add = Math.min(wishSpeed, cfg.airWishSpeed) - (v.x * wx + v.z * wz);
    if (add <= 0) return;
    const before = Math.hypot(v.x, v.z);
    const a = Math.min(cfg.airAccel * wishSpeed * dt, add);
    v.x += wx * a;
    v.z += wz * a;
    const after = Math.hypot(v.x, v.z);
    const cap = Math.max(before, cfg.airStrafeSpeedCap);
    if (after > cap) {
      const k = cap / after;
      v.x *= k;
      v.z *= k;
    }
  }

  /** Short downward sweep; true when standing on a surface shallow enough to walk on. */
  private probeGround(): boolean {
    const hit = this.cast(DOWN, this.cfg.skin + GROUND_PROBE);
    if (!hit) return false;
    const n = hit.normal1;
    if (n.y < this.minGroundY) return false;
    this.groundNormal.x = n.x;
    this.groundNormal.y = n.y;
    this.groundNormal.z = n.z;
    return true;
  }

  private canStand(): boolean {
    const c = { x: this.feet.x, y: this.feet.y + this.standHalf + this.cfg.radius, z: this.feet.z };
    return this.world.intersectionWithShape(c, IDENTITY, this.standProbe, QUERY_FLAGS, undefined, this.collider) === null;
  }

  private setCrouched(crouched: boolean): void {
    this.crouched = crouched;
    this.collider.setShape(crouched ? this.crouchShape : this.standShape);
    this.body.setTranslation(this.computeCenter(), true);
  }

  private computeCenter(): Vec3 {
    const half = this.crouched ? this.crouchHalf : this.standHalf;
    this.center.x = this.feet.x;
    this.center.y = this.feet.y + half + this.cfg.radius;
    this.center.z = this.feet.z;
    return this.center;
  }
}
