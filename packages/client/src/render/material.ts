import * as THREE from 'three';

/** Unlit vertex colours, for geometry with its shading baked in. */
export function bakedMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ vertexColors: true });
}

/**
 * Unlit vertex colours shaded per face on the GPU from the world-space normal, with the
 * same formula as shade.ts. For instanced or moving geometry, whose baked shading would
 * go wrong as it turns.
 */
export function shadedMaterial(): THREE.MeshBasicMaterial {
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
      vColor.rgb *= ( shadeN.y >= 0.0 ? 0.7 + 0.3 * shadeN.y : 0.7 + 0.2 * shadeN.y ) + 0.1 * abs( shadeN.x );`,
    );
  };
  return m;
}
