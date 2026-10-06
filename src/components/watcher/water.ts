// Water shading by quality (Settings → Graphics → Water):
// - simple: the game's texture, see-through, like the other translucent blocks;
// - fancy: ripples run across the surface and catch the light;
// - realistic: the ripples also reflect the sky (more at a glancing view, Fresnel), glint where they
//   mirror the sun or moon, and the water turns from clear looking down to solid toward the horizon.
// Only top surfaces ripple; the sides of falls and pools keep the simple look. Uses the world position
// and normal varyings blockLight.ts adds (from torchRays.ts), so apply it after applyBlockLight and before
// applyEdgeFog (the fog then covers the water's final color).
import * as THREE from 'three'
import type { WaterQuality } from '../../utils/graphicsSettings'

const QUALITY: Record<WaterQuality, number> = { simple: 0, fancy: 1, realistic: 2 }

const uniforms = {
  uWaterQuality: { value: 0 },
  uWaterTime: { value: 0 },
  uWaterSky: { value: new THREE.Color() },
  uWaterLightDirection: { value: new THREE.Vector3(0, 1, 0) },
  uWaterLightColor: { value: new THREE.Color() },
}

const FRAGMENT_HEAD = `
uniform float uWaterQuality;
uniform float uWaterTime;
uniform vec3 uWaterSky;
uniform vec3 uWaterLightDirection;
uniform vec3 uWaterLightColor;

// The surface's slope from a few crossing waves, each its own direction, length and speed.
vec2 waterSlope(vec2 p, float t) {
  vec2 slope = vec2(0.0);
  const int WAVES = 5;
  vec3 waves[WAVES] = vec3[WAVES](
    vec3(0.8, 0.6, 1.4), vec3(-0.5, 0.86, 2.3), vec3(0.2, -0.98, 3.7), vec3(-0.9, -0.3, 5.9), vec3(0.6, -0.8, 9.1)
  );
  for (int i = 0; i < WAVES; i++) {
    vec2 direction = waves[i].xy;
    float frequency = waves[i].z;
    float amplitude = 0.06 / frequency;
    float phase = dot(direction, p) * frequency + t * (0.9 + 0.35 * frequency);
    slope += direction * (amplitude * frequency * cos(phase));
  }
  return slope;
}
`

const FRAGMENT_BODY = `
  if (uWaterQuality > 0.5 && vRayNormal.y > 0.5) {
    vec2 slope = waterSlope(vRayWorld.xz, uWaterTime);
    vec3 waveNormal = normalize(vec3(-slope.x, 1.0, -slope.y));
    // Fancy: the ripples brighten and darken the surface as they face the light or turn from it.
    float facing = dot(waveNormal, uWaterLightDirection) - dot(vec3(0.0, 1.0, 0.0), uWaterLightDirection);
    outgoingLight *= 1.0 + facing * 2.4 + (waveNormal.x + waveNormal.z) * 0.35;
    if (uWaterQuality > 1.5) {
      vec3 toCamera = normalize(cameraPosition - vRayWorld);
      float cosine = max(dot(waveNormal, toCamera), 0.0);
      // Schlick's Fresnel: water reflects about 2% looking straight down, nearly all at a grazing view.
      float fresnel = 0.02 + 0.98 * pow(1.0 - cosine, 5.0);
      // The sky as the water sees it: a little lighter toward the horizon it mirrors.
      vec3 sky = uWaterSky * (1.0 + 0.25 * (1.0 - cosine));
      // The body: the water's own tint, deeper, with the texture's pattern softened.
      vec3 body = mix(outgoingLight, diffuseColor.rgb * 0.35 * (0.6 + 0.4 * dot(outgoingLight, vec3(0.6))), 0.45);
      outgoingLight = mix(body, sky, clamp(fresnel * 0.85, 0.0, 1.0));
      vec3 mirrored = reflect(-toCamera, waveNormal);
      float glint = pow(max(dot(mirrored, uWaterLightDirection), 0.0), 220.0);
      outgoingLight += uWaterLightColor * glint * 3.0;
      // Clear looking down, near solid at the horizon; glints show even where it's clear.
      diffuseColor.a = clamp(mix(0.5, 0.97, fresnel) + glint, 0.0, 1.0);
    }
  }
`

export const applyWater = (material: THREE.Material) => {
  const previousCompile = material.onBeforeCompile
  const previousKey = material.customProgramCacheKey
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
      .replace('#include <opaque_fragment>', `${FRAGMENT_BODY}\n  #include <opaque_fragment>`)
  }
  material.customProgramCacheKey = () => `${previousKey.call(material)}-water`
  material.needsUpdate = true
}

export const setWaterQuality = (quality: WaterQuality) => {
  uniforms.uWaterQuality.value = QUALITY[quality]
}

// Each frame: the time the waves run on, the sky's color and the sun or moon (direction toward it, and its
// color times its strength).
export const updateWater = (
  time: number,
  sky: THREE.Color,
  lightDirection: THREE.Vector3,
  lightColor: THREE.Color
) => {
  uniforms.uWaterTime.value = time
  uniforms.uWaterSky.value.copy(sky)
  uniforms.uWaterLightDirection.value.copy(lightDirection)
  uniforms.uWaterLightColor.value.copy(lightColor)
}
