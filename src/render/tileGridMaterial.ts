import * as THREE from 'three';

export interface TileGridOptions {
  /** Tile face colour. */
  baseColor?: THREE.ColorRepresentation;
  /** Seam colour. */
  lineColor?: THREE.ColorRepresentation;
  /** Tile edge length in metres. */
  tileSize?: number;
  /** Seam width in metres. */
  lineWidth?: number;
  /** If set, seams also emit this colour (picked up by bloom). */
  emissiveEdge?: THREE.ColorRepresentation | null;
  emissiveEdgeIntensity?: number;
  roughness?: number;
  metalness?: number;
}

export interface TileGridUniforms {
  uGridLineColor: THREE.IUniform<THREE.Color>;
  uGridTileSize: THREE.IUniform<number>;
  uGridLineWidth: THREE.IUniform<number>;
  uGridEdgeEmissive: THREE.IUniform<THREE.Color>;
}

export type TileGridMaterial = THREE.MeshStandardMaterial & { grid: TileGridUniforms };

const VERT_DECL = /* glsl */ `
varying vec3 vGridWorldPos;
varying vec3 vGridWorldNormal;
`;

const FRAG_DECL = /* glsl */ `
uniform vec3 uGridLineColor;
uniform float uGridTileSize;
uniform float uGridLineWidth;
uniform vec3 uGridEdgeEmissive;
varying vec3 vGridWorldPos;
varying vec3 vGridWorldNormal;

// Analytically filtered grid for one projection plane.
// Lines never get thinner than a pixel; instead they lose opacity, and once a
// whole tile is smaller than a pixel the result settles on the average line
// coverage. That is what keeps distant / grazing-angle seams from shimmering.
float tileGridPlane(vec2 uv, float lineWidth) {
  vec2 deriv = fwidth(uv);
  vec2 drawWidth = clamp(vec2(lineWidth), deriv, vec2(0.5));
  vec2 lineAA = deriv * 1.5;
  vec2 gridUV = 1.0 - abs(fract(uv) * 2.0 - 1.0);
  vec2 g = smoothstep(drawWidth + lineAA, drawWidth - lineAA, gridUV);
  g *= clamp(vec2(lineWidth) / drawWidth, 0.0, 1.0);
  g = mix(g, vec2(lineWidth), clamp(deriv * 2.0 - 1.0, 0.0, 1.0));
  return mix(g.x, 1.0, g.y);
}

// World-space triplanar blend of the three axis-aligned grids.
float tileGrid() {
  vec3 p = vGridWorldPos / uGridTileSize;
  vec3 w = pow(abs(normalize(vGridWorldNormal)), vec3(8.0));
  w /= (w.x + w.y + w.z);
  float lw = uGridLineWidth / uGridTileSize;
  float g = 0.0;
  if (w.x > 0.001) g += w.x * tileGridPlane(p.yz, lw);
  if (w.y > 0.001) g += w.y * tileGridPlane(p.xz, lw);
  if (w.z > 0.001) g += w.z * tileGridPlane(p.xy, lw);
  return g;
}
`;

/**
 * MeshStandardMaterial patched with a world-space triplanar tile grid.
 * Lighting, shadows, fog and tone mapping all come from the stock material.
 *
 * The grid is anchored in world space, so it is meant for static geometry:
 * on a moving object the seams would slide across the surface.
 */
export function createTileGridMaterial(opts: TileGridOptions = {}): TileGridMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: opts.baseColor ?? 0xf2f4f6,
    roughness: opts.roughness ?? 0.85,
    metalness: opts.metalness ?? 0.0,
  }) as TileGridMaterial;

  const emissive = new THREE.Color(0x000000);
  if (opts.emissiveEdge != null) {
    emissive.set(opts.emissiveEdge).multiplyScalar(opts.emissiveEdgeIntensity ?? 2.0);
  }

  material.grid = {
    uGridLineColor: { value: new THREE.Color(opts.lineColor ?? 0xb4bcc6) },
    uGridTileSize: { value: opts.tileSize ?? 1.0 },
    uGridLineWidth: { value: opts.lineWidth ?? 0.02 },
    uGridEdgeEmissive: { value: emissive },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, material.grid);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
      .replace(
        '#include <defaultnormal_vertex>',
        /* glsl */ `#include <defaultnormal_vertex>
        vGridWorldNormal = inverseTransformDirection(transformedNormal, viewMatrix);`,
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
        vec4 gridWorldPos = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          gridWorldPos = instanceMatrix * gridWorldPos;
        #endif
        vGridWorldPos = (modelMatrix * gridWorldPos).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float gridMask = tileGrid();
        diffuseColor.rgb = mix(diffuseColor.rgb, uGridLineColor, gridMask);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        totalEmissiveRadiance += uGridEdgeEmissive * gridMask;`,
      );
  };

  // Every tile-grid material shares one program; only the uniforms differ.
  material.customProgramCacheKey = () => 'tile-grid-v1';

  return material;
}
