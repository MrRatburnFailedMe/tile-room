import * as THREE from 'three';

const TRACERS = 32;
const SPARKS = 160;
const DECALS = 64;
const TRACER_LIFE = 0.08;
const DECAL_LIFE = 10;
const DECAL_FADE = 2;
const FLASH_LIFE = 0.06;

const Z = new THREE.Vector3(0, 0, 1);

interface Tracer {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  life: number;
}

interface Decal {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  life: number;
}

/** Pooled world-space shot effects: tracers, impact sparks, bullet-hole decals and the muzzle light. */
export class WeaponEffects {
  private readonly tracers: Tracer[] = [];
  private nextTracer = 0;

  private readonly decals: Decal[] = [];
  private nextDecal = 0;

  private readonly sparkPos = new Float32Array(SPARKS * 3);
  private readonly sparkVel = new Float32Array(SPARKS * 3);
  private readonly sparkLife = new Float32Array(SPARKS);
  private readonly sparks: THREE.Points;
  private nextSpark = 0;

  private readonly light = new THREE.PointLight(0xffa040, 0, 12, 2);
  private flashT = 0;

  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    // Tracers: thin emissive orange bars. Colour is above 1.0 so bloom picks them up.
    const tracerGeo = new THREE.BoxGeometry(0.018, 0.018, 1);
    for (let i = 0; i < TRACERS; i++) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      mat.color.setRGB(5, 1.9, 0.35);
      const mesh = new THREE.Mesh(tracerGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, life: 0 });
    }

    // Decals: small dark discs laid on the surface.
    const decalGeo = new THREE.CircleGeometry(0.055, 10) as unknown as THREE.PlaneGeometry;
    for (let i = 0; i < DECALS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x14171b, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const mesh = new THREE.Mesh(decalGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.decals.push({ mesh, life: 0 });
    }

    // Sparks: one Points cloud, parked far away while dead.
    this.sparkPos.fill(-9999);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    const mat = new THREE.PointsMaterial({ size: 0.05, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.color.setRGB(4, 1.6, 0.4);
    this.sparks = new THREE.Points(geo, mat);
    this.sparks.frustumCulled = false;
    scene.add(this.sparks);

    // Always in the scene (intensity 0 when idle) so the light count never changes and shaders don't recompile.
    scene.add(this.light);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const t = this.tracers[this.nextTracer];
    this.nextTracer = (this.nextTracer + 1) % TRACERS;
    const dir = this.tmp.subVectors(to, from);
    const len = dir.length();
    if (len < 0.05) return;
    t.mesh.position.copy(from).addScaledVector(dir, 0.5);
    t.mesh.quaternion.setFromUnitVectors(Z, dir.divideScalar(len));
    t.mesh.scale.set(1, 1, len);
    t.mesh.material.opacity = 1;
    t.mesh.visible = true;
    t.life = TRACER_LIFE;
  }

  /** Sparks at a hit, plus a bullet hole unless the thing hit is an enemy. */
  impact(point: THREE.Vector3, normal: THREE.Vector3, decal: boolean, count = 6): void {
    if (decal) {
      const d = this.decals[this.nextDecal];
      this.nextDecal = (this.nextDecal + 1) % DECALS;
      d.mesh.position.copy(point).addScaledVector(normal, 0.004);
      d.mesh.quaternion.setFromUnitVectors(Z, normal);
      d.mesh.rotateZ(Math.random() * Math.PI);
      d.mesh.material.opacity = 0.85;
      d.mesh.visible = true;
      d.life = DECAL_LIFE;
    }
    for (let i = 0; i < count; i++) {
      const k = this.nextSpark * 3;
      this.sparkLife[this.nextSpark] = 0.18 + Math.random() * 0.18;
      this.nextSpark = (this.nextSpark + 1) % SPARKS;
      this.sparkPos[k] = point.x + normal.x * 0.02;
      this.sparkPos[k + 1] = point.y + normal.y * 0.02;
      this.sparkPos[k + 2] = point.z + normal.z * 0.02;
      const v = this.tmp2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(5).addScaledVector(normal, 3.5);
      this.sparkVel[k] = v.x;
      this.sparkVel[k + 1] = v.y;
      this.sparkVel[k + 2] = v.z;
    }
  }

  muzzleFlash(position: THREE.Vector3): void {
    this.light.position.copy(position);
    this.flashT = FLASH_LIFE;
  }

  update(dt: number): void {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / TRACER_LIFE);
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (const d of this.decals) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life < DECAL_FADE) d.mesh.material.opacity = 0.85 * Math.max(0, d.life / DECAL_FADE);
      if (d.life <= 0) d.mesh.visible = false;
    }
    let anySpark = false;
    for (let i = 0; i < SPARKS; i++) {
      if (this.sparkLife[i] <= 0) continue;
      anySpark = true;
      const k = i * 3;
      this.sparkLife[i] -= dt;
      if (this.sparkLife[i] <= 0) {
        this.sparkPos[k + 1] = -9999;
        continue;
      }
      this.sparkVel[k + 1] -= 14 * dt;
      this.sparkPos[k] += this.sparkVel[k] * dt;
      this.sparkPos[k + 1] += this.sparkVel[k + 1] * dt;
      this.sparkPos[k + 2] += this.sparkVel[k + 2] * dt;
    }
    if (anySpark) this.sparks.geometry.attributes.position.needsUpdate = true;

    this.flashT = Math.max(0, this.flashT - dt);
    this.light.intensity = 30 * (this.flashT / FLASH_LIFE);
  }
}
