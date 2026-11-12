export type WeaponId = 'pistol' | 'smg' | 'shotgun';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** true: fires while the trigger is held. false: one shot per press. */
  auto: boolean;
  /** Damage per pellet. */
  damage: number;
  pellets: number;
  /** Shots per second. */
  fireRate: number;
  /** Rounds in the gun. There is no reloading: empty guns get thrown. */
  ammo: number;
  /** Half-angle of the spread cone, degrees. */
  spreadDeg: number;
  range: number;
  headshotMultiplier: number;
  recoil: {
    /** View kick per shot, degrees (recovers on its own). */
    pitchDeg: number;
    /** Random sideways view kick, ± degrees. */
    yawDeg: number;
    /** Viewmodel push-back, metres. */
    kick: number;
    /** Camera shake added per shot, 0..1. */
    shake: number;
  };
  /** Box-built model used for the viewmodel, floor pickups and thrown guns. */
  model: {
    length: number;
    height: number;
    width: number;
    grip: boolean;
    magazine: boolean;
    stock: boolean;
  };
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: {
    id: 'pistol',
    name: 'Pistol',
    auto: false,
    damage: 34,
    pellets: 1,
    fireRate: 6,
    ammo: 8,
    spreadDeg: 0.35,
    range: 120,
    headshotMultiplier: 2,
    recoil: { pitchDeg: 1.6, yawDeg: 0.4, kick: 0.05, shake: 0.14 },
    model: { length: 0.26, height: 0.07, width: 0.045, grip: true, magazine: false, stock: false },
  },
  smg: {
    id: 'smg',
    name: 'SMG',
    auto: true,
    damage: 15,
    pellets: 1,
    fireRate: 14,
    ammo: 30,
    spreadDeg: 1.5,
    range: 90,
    headshotMultiplier: 1.5,
    recoil: { pitchDeg: 0.7, yawDeg: 0.5, kick: 0.028, shake: 0.08 },
    model: { length: 0.42, height: 0.09, width: 0.055, grip: true, magazine: true, stock: true },
  },
  shotgun: {
    id: 'shotgun',
    name: 'Shotgun',
    auto: false,
    damage: 13,
    pellets: 8,
    fireRate: 1.3,
    ammo: 4,
    spreadDeg: 4.5,
    range: 45,
    headshotMultiplier: 1.25,
    recoil: { pitchDeg: 4.2, yawDeg: 0.8, kick: 0.1, shake: 0.32 },
    model: { length: 0.72, height: 0.075, width: 0.055, grip: true, magazine: false, stock: true },
  },
};
