import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

const MAX_PIXEL_RATIO = 2;

/** Draws a second scene over the first after clearing depth: the first-person weapon layer. */
class OverlayScenePass extends Pass {
  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {
    super();
    this.needsSwap = false;
  }

  override render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }
}

/** Screen-space speed effect: a soft vignette plus thin radial streaks near the screen edge. */
const SpeedFxShader = {
  uniforms: {
    tDiffuse: { value: null },
    uIntensity: { value: 0 },
    uTime: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uIntensity;
    uniform float uTime;
    uniform float uAspect;
    varying vec2 vUv;

    float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 p = vUv - 0.5;
      p.x *= uAspect;
      float r = length(p) / (0.5 * length(vec2(uAspect, 1.0))); // 0 centre .. 1 corner

      // Vignette
      c.rgb *= 1.0 - uIntensity * 0.32 * smoothstep(0.35, 1.0, r);

      // Streaks: 160 angular cells, a random fifth lit at a time, each flickering on its own clock.
      float a = atan(p.y, p.x) * 25.4648;
      float cell = floor(a);
      float seed = hash(cell);
      float lit = step(0.8, hash(cell + 17.0 * floor(uTime * 9.0 + seed * 5.0)));
      float thin = smoothstep(0.55, 1.0, 1.0 - abs(fract(a) - 0.5) * 2.0);
      float streak = lit * thin * smoothstep(0.5, 0.95, r) * (0.4 + 0.6 * seed);
      c.rgb += streak * uIntensity * 0.22;

      gl_FragColor = c;
    }`,
};

/** Bloom tuning: sunlit white surfaces sit just above the threshold, so they glow a little. */
export const BLOOM = { strength: 0.1, radius: 0.5, threshold: 0.86 };

export class RenderPipeline {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  private readonly fxaa: ShaderPass;
  private readonly speedFx: ShaderPass;

  constructor(
    canvas: HTMLCanvasElement,
    scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    // MSAA on the default framebuffer is wasted when rendering through a composer.
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.info.autoReset = false; // reset once per frame so stats cover every pass
    this.renderer = renderer;

    // Composer targets are half-float, so the scene stays HDR until OutputPass
    // applies ACES tone mapping and the sRGB transfer.
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    this.composer.addPass(this.bloom);

    this.composer.addPass(new OutputPass());

    // Speed lines / vignette, in display space; skipped entirely at low speed.
    this.speedFx = new ShaderPass(SpeedFxShader);
    this.speedFx.enabled = false;
    this.composer.addPass(this.speedFx);

    // FXAA wants display-referred colour, so it runs after OutputPass.
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get fxaaEnabled(): boolean {
    return this.fxaa.enabled;
  }

  set fxaaEnabled(on: boolean) {
    this.fxaa.enabled = on;
  }

  /** Render `scene` on top of the world (depth cleared first), before bloom. Used for the viewmodel. */
  addOverlayScene(scene: THREE.Scene, camera: THREE.Camera): void {
    this.composer.insertPass(new OverlayScenePass(scene, camera), 1);
  }

  /** Strength 0..1 of the speed effect; `time` in seconds drives the streak flicker. */
  setSpeedFx(intensity: number, time: number): void {
    this.speedFx.enabled = intensity > 0.005;
    this.speedFx.material.uniforms['uIntensity'].value = intensity;
    this.speedFx.material.uniforms['uTime'].value = time;
  }

  resize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const pr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.speedFx.material.uniforms['uAspect'].value = w / h;
    this.fxaa.material.uniforms['resolution'].value.set(1 / (w * pr), 1 / (h * pr));
  }

  render(): void {
    this.renderer.info.reset();
    this.composer.render();
  }
}
