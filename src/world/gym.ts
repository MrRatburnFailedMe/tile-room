import { LevelBuilder, type Level } from './builder';

/**
 * Movement gym: one straight lane running toward -Z, 4 m wide, meant to be taken in a single line.
 *
 *   z  50 →  16   runway (floor y=0) with two slide gates       sprint, slide, slide-hop, slide
 *   z  16 →  -7   pit                                            wall-run right, wall-jump, wall-run left
 *   z  -7 → -17   landing floor (y=-1)
 *   z -17 → -37   shaft: no floor, exit ledge 3.5 m up           chain wall-jumps between the walls
 *   z -37 → -45   ledge (y=2.5)
 *   z -45 → -57   downhill ramp to y=-1                          slide gains speed
 *   z -57 → -70   final slide gate and finish
 *
 * Orange-seamed walls are wall-runnable. Cyan-edged lintels are slide gates.
 */
export function buildGym(b: LevelBuilder): Level {
  const { floor, wall, prop, wallrun, glowGrid, light, orangeTrim, cyanTrim } = b.mats;

  const HALF = 2; // lane half-width
  const WALL_TOP = 7;
  const DEEP = -8; // bottom of floors and walls
  const GAP = 1.25; // slide-gate clearance

  b.lighting({ sunDir: [0.13, 1, 0.72], center: [0, 0, -10], halfWidth: 24, halfHeight: 66, mapSize: 4096 });

  // --- Floors ----------------------------------------------------------------
  const floorSpan = (z0: number, z1: number, top: number) => b.span([-HALF, DEEP, z0], [HALF, top, z1], floor);
  floorSpan(50, 16, 0);
  floorSpan(-7, -17, -1);
  floorSpan(-37, -45, 2.5);
  floorSpan(-45, -70, -1);
  b.ramp(4, 3.5, 12, [0, -1, -51], Math.PI); // high end at z=-45, down to the floor at z=-57

  // Dark glowing floor far below the pit and the shaft (below the kill height; just something to see).
  b.span([-HALF, DEEP - 1, 16], [HALF, DEEP, -7], glowGrid);
  b.span([-HALF, DEEP - 1, -17], [HALF, DEEP, -37], glowGrid);

  // --- Walls: plain segments and wall-runnable segments ----------------------------
  const wallSeg = (side: 1 | -1, z0: number, z1: number, runnable = false, railLow = 0, railHigh = 5) => {
    const x0 = side * HALF;
    const x1 = side * (HALF + 1);
    b.span([x0, DEEP, z0], [x1, WALL_TOP, z1], runnable ? wallrun : wall, runnable ? { tag: 'wallrun' } : {});
    if (runnable) {
      // Orange rails top and bottom, plus end posts, so the panel reads from a distance.
      const xi = side * (HALF - 0.05);
      for (const y of [railLow, railHigh]) b.trim([x0, y - 0.06, z0], [xi, y + 0.06, z1], orangeTrim);
      for (const z of [z0, z1]) b.trim([x0, railLow, z - 0.06], [xi, railHigh, z + 0.06], orangeTrim);
    }
  };
  // Right (+x)
  wallSeg(1, 51, 17);
  wallSeg(1, 17, 3, true, 0.2, 5);
  wallSeg(1, 3, -16);
  wallSeg(1, -16, -41, true, -0.8, 6.5);
  wallSeg(1, -41, -71);
  // Left (-x)
  wallSeg(-1, 51, 7);
  wallSeg(-1, 7, -8, true, -0.8, 5);
  wallSeg(-1, -8, -16);
  wallSeg(-1, -16, -41, true, -0.8, 6.5);
  wallSeg(-1, -41, -71);
  // Ends
  b.span([-HALF - 1, DEEP, 51], [HALF + 1, WALL_TOP, 52], wall);
  b.span([-HALF - 1, DEEP, -70], [HALF + 1, WALL_TOP, -71], wall);

  // --- Slide gates ---------------------------------------------------------------
  const gate = (z: number, floorY: number) => {
    b.span([-HALF, floorY + GAP, z + 0.5], [HALF, floorY + GAP + 2.5, z - 0.5], prop);
    b.trim([-HALF, floorY + GAP - 0.04, z + 0.56], [HALF, floorY + GAP + 0.06, z + 0.5], cyanTrim);
  };
  gate(35.5, 0);
  gate(23.5, 0);
  gate(-60.5, -1);

  // --- Start and finish markers ---------------------------------------------------
  b.trim([-HALF, 0, 45.1], [HALF, 0.02, 44.9], cyanTrim);
  b.trim([-HALF, -1, -63.9], [HALF, -0.98, -64.1], light);
  b.trim([-1.5, 2.3, -69.9], [1.5, 2.6, -70], light);

  return {
    name: 'gym',
    checkpoints: [
      { x: 0, y: 0, z: 48, yaw: 0 },
      { x: 0, y: 0, z: 20, yaw: 0 },
      { x: 0, y: -1, z: -10, yaw: 0 },
      { x: 0, y: 2.5, z: -40, yaw: 0 },
    ],
    killY: -5,
    startZ: 45,
    finishZ: -64,
    startWeapon: 'pistol',
    dummies: [{ x: 0, y: -1, z: -69, yaw: Math.PI, weapon: 'smg' }],
  };
}
