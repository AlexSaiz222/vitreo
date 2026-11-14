import type { WebGLProgramParametersWithUniforms } from 'three';

/** Wind speeds (radians per second): slow, nothing that reads as a loop. */
const SWAY_SPEED = { x: 0.9, z: 0.7 } as const;

/** Uniforms of a swaying material; `uTime` is advanced every frame (0 with reduced motion). */
export interface Wind {
  uTime: { value: number };
  /** How far a tip moves, in the mesh's own units. */
  uSway: { value: number };
  /** So that meshes sharing one geometry do not sway in step. */
  uPhase: { value: number };
}

/**
 * Makes a material sway (plants and decor, docs/02: slow, organic). The
 * `_WIND` attribute from Blender (three calls it `_wind`) says how much each
 * vertex moves, 0 at the base and 1 at the tips. Works with shape keys: the
 * sway is added after them.
 */
export function swayWith(wind: Wind) {
  return (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, wind);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uSway;
        uniform float uPhase;
        attribute float _wind;`,
      )
      .replace(
        '#include <morphtarget_vertex>',
        `#include <morphtarget_vertex>
        float reach = _wind * uSway;
        float phase = position.y * 3.0 + position.x * 2.0 + uPhase;
        transformed.x += sin(uTime * ${SWAY_SPEED.x.toFixed(2)} + phase) * reach;
        transformed.z += cos(uTime * ${SWAY_SPEED.z.toFixed(2)} + phase * 1.3) * reach * 0.6;`,
      );
  };
}
