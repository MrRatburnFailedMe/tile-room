const REFRESH_MS = 250;

export interface StatsExtras {
  calls: number;
  triangles: number;
  width: number;
  height: number;
  bodies: number;
  colliders: number;
  fxaa: boolean;
  player: string;
}

/** Lightweight FPS / frame-time / renderer stats readout. */
export class StatsOverlay {
  visible = false;
  /** Rolling average over the last refresh window; readable even while hidden. */
  fps = 0;

  private frames = 0;
  private elapsed = 0;
  private worst = 0;

  constructor(private readonly el: HTMLElement) {}

  toggle(): boolean {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
    return this.visible;
  }

  /** Call once per frame with the raw (unclamped) frame time in ms. */
  update(frameMs: number, extras: () => StatsExtras): void {
    this.frames++;
    this.elapsed += frameMs;
    if (frameMs > this.worst) this.worst = frameMs;
    if (this.elapsed < REFRESH_MS) return;

    const avg = this.elapsed / this.frames;
    this.fps = 1000 / avg;
    if (this.visible) {
      const x = extras();
      this.el.textContent =
        `${this.fps.toFixed(0).padStart(3)} fps   ${avg.toFixed(1)} ms avg   ${this.worst.toFixed(1)} ms max\n` +
        `draw calls ${x.calls}   tris ${x.triangles.toLocaleString()}\n` +
        `${x.width}×${x.height}   fxaa ${x.fxaa ? 'on' : 'off'}\n` +
        `physics: ${x.bodies} bodies, ${x.colliders} colliders\n` +
        `player: ${x.player}`;
    }
    this.frames = 0;
    this.elapsed = 0;
    this.worst = 0;
  }
}
