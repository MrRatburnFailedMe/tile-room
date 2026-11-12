import * as THREE from 'three';
import type { WeaponDef } from './weaponDefs';

const metal = new THREE.MeshStandardMaterial({ color: 0x4a515c, roughness: 0.5, metalness: 0.15 });
const dark = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.7, metalness: 0.1 });
const accent = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff7a1a, emissiveIntensity: 1.4, roughness: 0.4 });

/**
 * Build a weapon out of boxes from its data. The barrel points down -Z and the
 * origin sits at the grip. `userData.muzzle` is the muzzle position in local space.
 */
export function buildWeaponModel(def: WeaponDef): THREE.Group {
  const m = def.model;
  const g = new THREE.Group();
  const add = (w: number, h: number, l: number, x: number, y: number, z: number, mat: THREE.Material): void => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
  };

  const front = -m.length * 0.7; // muzzle end
  const back = m.length * 0.3;
  const mid = (front + back) / 2;

  add(m.width, m.height, m.length, 0, 0, mid, metal); // receiver + barrel
  add(m.width * 0.5, m.height * 0.35, m.length * 0.5, 0, m.height * 0.6, mid - m.length * 0.1, dark); // top rail
  add(m.width + 0.004, m.height * 0.22, m.length * 0.3, 0, 0, front + m.length * 0.3, accent); // orange band
  if (m.grip) add(m.width * 0.9, 0.12, 0.05, 0, -m.height / 2 - 0.05, back - 0.06, dark);
  if (m.magazine) add(m.width * 0.8, 0.15, 0.045, 0, -m.height / 2 - 0.07, mid - 0.02, dark);
  if (m.stock) add(m.width * 0.8, m.height * 0.8, 0.2, 0, -0.01, back + 0.1, dark);

  g.userData.muzzle = new THREE.Vector3(0, 0, front - 0.02);
  return g;
}
