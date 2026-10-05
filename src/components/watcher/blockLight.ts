// Light from torches, lanterns, glowstone, lava and the like. The bot sends the game's block light per
// face (see src/bot/worldView.js) and the mesher stores it per vertex; each surface is then lit by
// whichever is brighter, the sky and sun or the warm block light, as the game does.
import * as THREE from 'three'
import { FRAGMENT_HEAD, rayUniforms, VERTEX_BODY, VERTEX_HEAD } from './torchRays'

// The game's falloff: light 15 is full bright and it fades quickly toward the dark end.
const GLOW = `
  // With ray-cast torches on, nearby torch light only reaches where a ray to the torch is clear.
  float blockLevel = rayBlockLight(vBlockLight);
  float blockGlow = blockLevel / (4.0 - 3.0 * blockLevel);
  outgoingLight = max(outgoingLight, diffuseColor.rgb * vec3(1.0, 0.86, 0.68) * blockGlow);
`

// Chains onto any shader patch the material already has (see seeThrough.ts), so call it after those.
export const applyBlockLight = (material: THREE.Material) => {
  const previousCompile = material.onBeforeCompile
  const previousKey = material.customProgramCacheKey
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer)
    Object.assign(shader.uniforms, rayUniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nattribute float blockLight;\nvarying float vBlockLight;\n${VERTEX_HEAD}`
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vBlockLight = blockLight;')
      .replace('#include <project_vertex>', `#include <project_vertex>${VERTEX_BODY}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vBlockLight;\n${FRAGMENT_HEAD}`)
      .replace('#include <opaque_fragment>', `${GLOW}\n  #include <opaque_fragment>`)
  }
  material.customProgramCacheKey = () => `${previousKey.call(material)}-block-light`
  material.needsUpdate = true
}
