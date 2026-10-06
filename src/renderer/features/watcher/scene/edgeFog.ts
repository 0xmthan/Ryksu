// Distance fog for the blocks: the world fades into the sky toward the edge of what the bot sends, so it
// ends softly instead of at a hard cliff. Measured across the ground from the bot, not from the camera, so
// zooming out shows the same round patch of world rather than fogging all of it.
import * as THREE from 'three'

const uniforms = {
  uFogCenter: { value: new THREE.Vector3() },
  uFogColor: { value: new THREE.Color() },
  uFogNear: { value: 30 },
  uFogFar: { value: 50 },
  uFogStrength: { value: 0 },
}

const FOG = `
  float edgeFog = smoothstep(uFogNear, uFogFar, length(vFogWorld.xz - uFogCenter.xz)) * uFogStrength;
  outgoingLight = mix(outgoingLight, uFogColor, edgeFog);
`

// Chains onto any shader patch the material already has (see blockLight.ts), so call it after those.
export const applyEdgeFog = (material: THREE.Material) => {
  const previousCompile = material.onBeforeCompile
  const previousKey = material.customProgramCacheKey
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFogWorld;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n  vFogWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vFogWorld;\nuniform vec3 uFogCenter;\nuniform vec3 uFogColor;\n' +
          'uniform float uFogNear;\nuniform float uFogFar;\nuniform float uFogStrength;'
      )
      .replace('#include <opaque_fragment>', `${FOG}\n  #include <opaque_fragment>`)
  }
  material.customProgramCacheKey = () => `${previousKey.call(material)}-edge-fog`
  material.needsUpdate = true
}

// Mobs, players and items fade with the blocks around them. Run again as models change (a new held item);
// materials already fogged are skipped.
const fogged = new WeakSet<THREE.Material>()
export const fogObject = (object: THREE.Object3D) => {
  object.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return
    const material = (child as THREE.Mesh).material
    for (const entry of Array.isArray(material) ? material : [material]) {
      // Built-in materials only: a custom shader has no chunks to patch.
      if (fogged.has(entry) || (entry as THREE.ShaderMaterial).isShaderMaterial) continue
      fogged.add(entry)
      applyEdgeFog(entry)
    }
  })
}

// Each frame: centered on the bot (scene coordinates), in the sky's color, ending just inside the edge of
// the blocks (`radius` blocks from the bot).
export const updateEdgeFog = (
  enabled: boolean,
  center: THREE.Vector3,
  color: THREE.Color,
  radius: number
) => {
  uniforms.uFogStrength.value = enabled ? 1 : 0
  uniforms.uFogCenter.value.copy(center)
  uniforms.uFogColor.value.copy(color)
  uniforms.uFogFar.value = radius - 2
  uniforms.uFogNear.value = radius * 0.55
}
