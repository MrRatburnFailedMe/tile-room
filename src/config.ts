/** Tunables. Distances in metres, speeds in m/s, times in seconds. */
export const config = {
  look: {
    /** Radians of rotation per pixel of mouse movement. */
    sensitivity: 0.0022,
    invertY: false,
  },

  player: {
    // Capsule
    radius: 0.4,
    height: 1.8,
    crouchHeight: 1.0,
    /** Gap the character controller keeps from surfaces. */
    skin: 0.02,
    maxSlopeDeg: 46,
    /** How far down the player is pulled to stay on ramps and small drops while walking. */
    snapDistance: 0.3,

    // Ground movement (Quake-style: accel is "fraction of wish speed per second")
    walkSpeed: 6,
    sprintSpeed: 9,
    crouchSpeed: 3,
    /** When true, Shift walks instead of sprints. Toggle in game with X. */
    alwaysSprint: false,
    groundAccel: 10,
    friction: 6,
    /** Below this speed friction behaves as if moving at this speed, so stops are crisp. */
    stopSpeed: 2.5,

    // Air movement
    airAccel: 10,
    /** Cap on wish speed in the air. Small value = little direct air control, but strafing works. */
    airWishSpeed: 0.8,
    /** Air strafing cannot push horizontal speed past this. Existing speed above it is kept. */
    airStrafeSpeedCap: 16,
    gravity: 22,
    jumpSpeed: 7.3,
    terminalSpeed: 50,

    // Jump forgiveness
    jumpBuffer: 0.1,
    coyoteTime: 0.1,
    /** Hold Space to keep hopping. Off: each hop needs its own press (buffered). */
    autoHop: false,

    slide: {
      /** Minimum horizontal speed to enter a slide: just above walk speed. */
      minSpeed: 6.3,
      /** Slide ends (becomes a crouch-walk) below this speed. */
      stopSpeed: 3,
      friction: 0.35,
      /** Fractional speed gain on slide entry (+20%), never taking you past boostMaxSpeed. */
      boost: 0.2,
      boostMaxSpeed: 15,
      boostCooldown: 1,
    },

    wallrun: {
      /** Collider tag a surface needs to be runnable. */
      tag: 'wallrun',
      /** Minimum speed along the wall to start or keep running. */
      minSpeed: 4,
      /** Holding forward accelerates along the wall up to this. */
      speed: 9.5,
      accel: 12,
      /** Along-wall deceleration with no forward input. */
      drag: 3,
      gravityScale: 0.2,
      maxTime: 1.5,
      maxFallSpeed: 4,
      /** Vertical speed is clamped to this range when you attach. */
      attachMaxRise: 3,
      attachMaxFall: 1.5,
      /** How close (beyond the skin) the wall must be to attach. */
      reach: 0.35,
      /** Max ratio of into-wall speed to along-wall speed: 1.2 is about 50 degrees off parallel. */
      maxApproach: 1.2,
      /** Small speed held into the wall so contact is kept. */
      stick: 1,
      /** Wall-jump: speed away from the wall, and upward. Forward speed is kept. */
      jumpPush: 5.5,
      jumpUp: 8.5,
      /** Grace period to wall-jump after the run ends. */
      coyoteTime: 0.15,
    },
  },

  weapons: {
    /** Speed a thrown gun leaves the hand at. */
    throwSpeed: 24,
    /** A thrown gun deals this and stuns; it kills anything at or below this health. */
    throwDamage: 50,
    stunTime: 2,
    /** A thrown gun stops being dangerous after this long, or below this speed. */
    throwLethalTime: 2.5,
    throwLethalSpeed: 4,
    /** E picks up the nearest gun within this distance. */
    pickupRange: 2.4,
    /** Walking this close to a loaded gun with empty hands picks it up. */
    autoPickupRange: 1.1,
    /** Semi-auto presses made slightly early are remembered for this long. */
    fireBuffer: 0.12,
    /** Freeze-frame on a kill. */
    hitstop: 0.03,
    killShake: 0.45,
    throwHitShake: 0.3,
  },

  dummies: {
    health: 100,
    respawnTime: 6,
  },

  camera: {
    eyeHeight: 1.62,
    crouchEyeHeight: 0.9,
    eyeLerp: 14,

    baseFov: 90,
    maxFov: 105,
    /** FOV starts widening above this speed and reaches maxFov at fovSpeedMax. */
    fovSpeedMin: 6.5,
    fovSpeedMax: 15,
    fovLerp: 8,

    /** Camera roll, degrees. */
    slideRoll: 3.5,
    wallRunRoll: 12,
    rollLerp: 9,

    /** Speed lines + vignette fade in between these speeds. */
    speedFx: { min: 9.5, max: 15, lerp: 6 },

    bob: {
      vertical: 0.028,
      lateral: 0.016,
      /** Radians of bob phase per metre travelled. */
      frequency: 2.6,
      fade: 12,
    },

    landing: {
      /** Impacts slower than this produce no dip. */
      minImpact: 3,
      /** Downward camera velocity per m/s of impact. */
      kick: 0.45,
      maxKick: 5,
      stiffness: 180,
      damping: 22,
    },
  },
};

export type PlayerConfig = typeof config.player;
export type CameraConfig = typeof config.camera;
