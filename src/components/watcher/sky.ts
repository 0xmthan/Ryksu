// Day and night for the watcher, following the world's time: the sun and moon cross the sky as square
// discs like the game's, the sky and fog shift through dawn, day, dusk and night, stars come out, and the
// sun (or moon) casts shadows around the bot. Caves skip the sky and get a dim light that follows the bot.
import * as THREE from 'three'
import type { ViewMode } from '../../utils/viewMode'

const DAY_SKY = new THREE.Color('#7ba4ff')
const DUSK_SKY = new THREE.Color('#e9946a')
const NIGHT_SKY = new THREE.Color('#0b1226')
const CAVE_SKY = new THREE.Color('#0d1118')
const SUN_COLOR = new THREE.Color('#fff6e0')
const DUSK_SUN_COLOR = new THREE.Color('#ffb27a')
const MOON_COLOR = new THREE.Color('#9fb4ff')

// Fog distances in blocks; caves keep it closer so the dark closes in.
const FOG = { open: { near: 110, far: 240 }, cave: { near: 55, far: 140 } }
// How far around the bot shadows reach, and how far away the lights and discs sit.
const SHADOW_RANGE = 85
const LIGHT_DISTANCE = 180
const DISC_DISTANCE = 380
// How fast the look eases toward a change (per second), e.g. walking into a cave.
const EASE_RATE = 3
const DAY_TICKS = 24000

const makeStars = () => {
  const positions: number[] = []
  for (let i = 0; i < 700; i++) {
    // Random points on the upper part of a sphere.
    const y = Math.random() * 1.1 - 0.1
    const angle = Math.random() * Math.PI * 2
    const radius = Math.sqrt(1 - y * y)
    positions.push(
      Math.cos(angle) * radius * DISC_DISTANCE,
      y * DISC_DISTANCE,
      Math.sin(angle) * radius * DISC_DISTANCE
    )
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    color: '#ffffff',
    size: 1.6,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    fog: false,
    depthWrite: false,
  })
  return new THREE.Points(geometry, material)
}

const makeDisc = (color: string, size: number) => {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ color, fog: false, depthWrite: false }))
  sprite.scale.setScalar(size)
  return sprite
}

export const createSky = (scene: THREE.Scene, renderer: THREE.WebGLRenderer) => {
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const background = DAY_SKY.clone()
  scene.background = background
  const fog = new THREE.Fog(background.clone(), FOG.open.near, FOG.open.far)
  scene.fog = fog

  const ambient = new THREE.AmbientLight(0xffffff, 1)
  const light = new THREE.DirectionalLight(0xffffff, 1)
  light.castShadow = true
  light.shadow.mapSize.set(2048, 2048)
  Object.assign(light.shadow.camera, {
    left: -SHADOW_RANGE,
    right: SHADOW_RANGE,
    top: SHADOW_RANGE,
    bottom: -SHADOW_RANGE,
    near: 1,
    far: LIGHT_DISTANCE * 2,
  })
  light.shadow.bias = -0.0004
  light.shadow.normalBias = 0.04
  // A warm glow around the bot underground, like carrying a torch.
  const lantern = new THREE.PointLight('#ffc98a', 0, 16, 1.2)
  const stars = makeStars()
  const sun = makeDisc('#fff3c4', 22)
  const moon = makeDisc('#dfe6ff', 14)
  scene.add(ambient, light, light.target, lantern, stars, sun, moon)

  const sunDirection = new THREE.Vector3()
  const wanted = new THREE.Color()
  let caveAmount = 0
  let skyTime: number | null = null

  // timeOfDay: 0-24000 game ticks (0 sunrise, 6000 noon, 12000 sunset, 18000 midnight).
  const update = (timeOfDay: number, mode: ViewMode, focus: THREE.Vector3, delta: number) => {
    const ease = 1 - Math.exp(-delta * EASE_RATE)
    caveAmount += ((mode === 'cave' ? 1 : 0) - caveAmount) * ease

    // Server time arrives in steps. Ease the shared sun/shadow clock each frame, taking the
    // shortest route across midnight so the sky doesn't spin backward when time wraps.
    const targetTime = THREE.MathUtils.euclideanModulo(timeOfDay, DAY_TICKS)
    if (skyTime === null) skyTime = targetTime
    const timeDifference =
      THREE.MathUtils.euclideanModulo(targetTime - skyTime + DAY_TICKS / 2, DAY_TICKS) - DAY_TICKS / 2
    skyTime = THREE.MathUtils.euclideanModulo(skyTime + timeDifference * ease, DAY_TICKS)
    const angle = (skyTime / DAY_TICKS) * Math.PI * 2
    // Rises in the east (+x), sets in the west, tilted a little south so shadows aren't straight lines.
    sunDirection.set(Math.cos(angle), Math.sin(angle), 0.3).normalize()
    const height = sunDirection.y
    const day = THREE.MathUtils.smoothstep(height, -0.15, 0.25)
    const dusk = Math.max(0, 1 - Math.abs(height) / 0.3) * 0.75

    wanted
      .copy(NIGHT_SKY)
      .lerp(DAY_SKY, day)
      .lerp(DUSK_SKY, dusk * 0.6)
      .lerp(CAVE_SKY, caveAmount)
    background.lerp(wanted, ease)
    fog.color.copy(background)
    fog.near += (THREE.MathUtils.lerp(FOG.open.near, FOG.cave.near, caveAmount) - fog.near) * ease
    fog.far += (THREE.MathUtils.lerp(FOG.open.far, FOG.cave.far, caveAmount) - fog.far) * ease

    // The sun lights the day; after dusk the moon takes over from the other side, dimmer and bluer.
    const sunUp = height > -0.05
    const direction = sunUp ? sunDirection : sunDirection.clone().negate()
    light.position.copy(focus).addScaledVector(direction, LIGHT_DISTANCE)
    light.target.position.copy(focus)
    light.color.copy(sunUp ? SUN_COLOR : MOON_COLOR)
    if (sunUp) light.color.lerp(DUSK_SUN_COLOR, dusk)
    const open = 1 - caveAmount
    light.intensity = (sunUp ? 0.25 + day * 0.65 : 0.22) * open
    light.castShadow = open > 0.5
    ambient.intensity = THREE.MathUtils.lerp(0.4 + day * 0.4, 0.75, caveAmount)
    lantern.position.copy(focus).add(new THREE.Vector3(0, 2, 0))
    lantern.intensity = caveAmount * 1.4

    const night = 1 - day
    ;(stars.material as THREE.PointsMaterial).opacity = night * night * open
    stars.position.copy(focus)
    stars.rotation.z = angle
    sun.position.copy(focus).addScaledVector(sunDirection, DISC_DISTANCE)
    moon.position.copy(focus).addScaledVector(sunDirection, -DISC_DISTANCE)
    sun.visible = open > 0.5 && height > -0.2
    moon.visible = open > 0.5 && height < 0.2
  }

  return { update }
}
