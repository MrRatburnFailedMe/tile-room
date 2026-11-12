import type { PlayerController } from '../player/playerController';
import type { Level, SpawnPoint } from './builder';

const CHECKPOINT_RADIUS = 2.5;

/** Checkpoints, kill-plane respawns and the run timer for a level. */
export class Course {
  /** Index of the checkpoint the player will respawn at. */
  current = 0;
  respawns = 0;
  /** Seconds on the clock for the current / last run. */
  time = 0;
  running = false;
  finished = false;

  constructor(
    readonly level: Level,
    private readonly player: PlayerController,
  ) {}

  get timed(): boolean {
    return this.level.startZ !== undefined && this.level.finishZ !== undefined;
  }

  /** Call once per physics tick. Returns the spawn point if the player was just respawned. */
  update(dt: number): SpawnPoint | null {
    const { level, player } = this;
    const f = player.feet;

    if (f.y < level.killY) return this.respawn();

    // Reaching a later checkpoint (on the ground, near it) makes it the respawn point.
    if (player.grounded) {
      for (let i = this.current + 1; i < level.checkpoints.length; i++) {
        const c = level.checkpoints[i];
        if (Math.hypot(f.x - c.x, f.z - c.z) < CHECKPOINT_RADIUS && Math.abs(f.y - c.y) < 1) this.current = i;
      }
    }

    if (this.timed) {
      if (!this.running && !this.finished && f.z < level.startZ!) {
        this.running = true;
        this.time = 0;
      }
      if (this.running) {
        this.time += dt;
        if (f.z < level.finishZ!) {
          this.running = false;
          this.finished = true;
        }
      }
    }
    return null;
  }

  /** Back to the current checkpoint. */
  respawn(): SpawnPoint {
    const c = this.level.checkpoints[this.current];
    this.player.teleport(c);
    this.respawns++;
    return c;
  }

  /** Back to the start with the clock reset. */
  restart(): SpawnPoint {
    this.current = 0;
    this.respawns = 0;
    this.time = 0;
    this.running = false;
    this.finished = false;
    const c = this.level.checkpoints[0];
    this.player.teleport(c);
    return c;
  }
}
