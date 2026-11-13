import * as THREE from 'three';

/** Unlit vertex colors, for geometry with its shading baked in. */
export function bakedMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ vertexColors: true });
}

/**
 * GLSL for shade.ts's formula, multiplying vColor by the shade of world-space normal
 * `shadeN`. With `key`, item models and characters also get the key light: faces turned to
 * the camera's left are up to 8% brighter and those turned right up to 8% darker, so
 * facets that only differ left to right still read (the look target in design/overview.md
 * → Characters). It follows the camera, so it reads the same from every side. Maps don't
 * get it.
 */
export function shadeGlsl(key: boolean): string {
  const base =
    '( shadeN.y >= 0.0 ? 0.7 + 0.3 * shadeN.y : 0.7 + 0.2 * shadeN.y ) + 0.1 * abs( shadeN.x )';
  if (!key) return `vColor.rgb *= ${base};`;
  return `vColor.rgb *= ${base} - 0.08 * normalize( mat3( viewMatrix ) * shadeN ).x;`;
}

/**
 * Unlit vertex colors shaded per face on the GPU from the world-space normal, with the
 * same formula as shade.ts. For instanced or moving geometry, whose baked shading would
 * go wrong as it turns. `key` adds the key light (shadeGlsl): for item models only.
 */
export function shadedMaterial(opts: { key?: boolean } = {}): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <color_vertex>',
      `#include <color_vertex>
      vec3 shadeN = normal;
      #ifdef USE_INSTANCING
        shadeN = mat3( instanceMatrix ) * shadeN;
      #endif
      shadeN = normalize( mat3( modelMatrix ) * shadeN );
      ${shadeGlsl(opts.key === true)}`,
    );
  };
  if (opts.key) m.customProgramCacheKey = () => 'shaded-key';
  return m;
}

/** shadedMaterial for item models: guns in hand, items on the ground, pictures, the editor. */
export function itemMaterial(): THREE.MeshBasicMaterial {
  return shadedMaterial({ key: true });
}
