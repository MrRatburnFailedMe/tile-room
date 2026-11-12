const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyQ', 'KeyE', 'KeyX', 'KeyF', 'KeyG',
  'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
]);

/** Keyboard state plus an edge-triggered jump press that survives until a physics tick reads it. */
export class Input {
  private readonly keys = new Set<string>();
  private jumpQueued = false;
  private fireQueued = false;
  private throwQueued = false;
  private pickupQueued = false;
  private mouseFire = false;

  constructor(isCaptured: () => boolean) {
    window.addEventListener('keydown', (e) => {
      // While the mouse is captured, stop Space scrolling, Ctrl+S / Ctrl+D dialogs and the like.
      if (isCaptured() && GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.jumpQueued = true;
      if (e.code === 'KeyE') this.pickupQueued = true;
      // Keyboard alternatives to the mouse buttons: F fires, G throws.
      if (e.code === 'KeyF') this.fireQueued = true;
      if (e.code === 'KeyG') this.throwQueued = true;
    });

    // Mouse buttons only count while the mouse is captured, so the click that captures it doesn't fire.
    window.addEventListener('mousedown', (e) => {
      if (!isCaptured()) return;
      if (e.button === 0) {
        this.mouseFire = true;
        this.fireQueued = true;
      } else if (e.button === 2) {
        this.throwQueued = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseFire = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.jumpQueued = false;
      this.mouseFire = false;
    });
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  /** -1, 0 or +1 from a pair of keys. */
  axis(negative: string, positive: string): number {
    return (this.keys.has(positive) ? 1 : 0) - (this.keys.has(negative) ? 1 : 0);
  }

  get fireHeld(): boolean {
    return this.mouseFire || this.keys.has('KeyF');
  }

  /** True once per trigger press. */
  consumeFire(): boolean {
    const v = this.fireQueued;
    this.fireQueued = false;
    return v;
  }

  /** True once per throw press (right mouse button or G). */
  consumeThrow(): boolean {
    const v = this.throwQueued;
    this.throwQueued = false;
    return v;
  }

  /** True once per E press. */
  consumePickup(): boolean {
    const v = this.pickupQueued;
    this.pickupQueued = false;
    return v;
  }

  /** True once per Space press. */
  consumeJump(): boolean {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }
}
