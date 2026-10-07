// Flames on a burning entity, drawn the way the game does: alternating fire_0/fire_1 quads stacked up
// its hitbox, each a little higher, narrower and further back, all turned to face the camera.
import * as THREE from 'three'
import { entityData } from './data'
import { pixelated } from './textures'

// fire_0 plays its strip starting halfway through (its .mcmeta), fire_1 in order; one frame per tick.
const FRAME_OFFSETS = [16, 0]
const TICKS_PER_SECOND = 20

type FireSprite = { texture: THREE.Texture; frames: number; offset: number }
let sprites: FireSprite[] | null = null

// The two animated strips, loaded once; their offsets are moved through the frames as time passes.
const fireSprites = () => {
  sprites ??= entityData.fire.flatMap((index, i) => {
    if (index === null) return []
    const { src, width = 16, height = 16 } = entityData.textures[index]
    const frames = Math.max(1, Math.round(height / width))
    const texture = pixelated(new THREE.TextureLoader().load(src))
    texture.repeat.set(1, 1 / frames)
    return [{ texture, frames, offset: FRAME_OFFSETS[i] ?? 0 }]
  })
  return sprites
}

export type Flames = {
  object: THREE.Object3D
  // Turns the flames to the camera and steps their animation.
  update: (camera: THREE.Camera, now: number) => void
}

const viewDirection = new THREE.Vector3()
const parentRotation = new THREE.Quaternion()
const facing = new THREE.Quaternion()
const UP = new THREE.Vector3(0, 1, 0)

export const createFlames = (width: number, height: number): Flames | null => {
  const textures = fireSprites()
  if (!textures.length) return null
  // The game's units: quads 1.4 tall scaled by the hitbox width × 1.4.
  const scale = width * 1.4
  const positions: number[] = []
  const uvs: number[] = []
  const geometry = new THREE.BufferGeometry()
  let halfWidth = 0.5
  let bottom = 0
  let left = height / scale
  let depth = 0.3 - Math.floor(left) * 0.02
  for (let i = 0; left > 0; i++) {
    // Every other pair is mirrored, so the stack doesn't repeat.
    const [u0, u1] = Math.floor(i / 2) % 2 === 0 ? [1, 0] : [0, 1]
    const x0 = -halfWidth * scale
    const x1 = halfWidth * scale
    const y0 = bottom * scale
    const y1 = (bottom + 1.4) * scale
    const z = depth * scale
    positions.push(x1, y0, z, x0, y0, z, x0, y1, z, x1, y0, z, x0, y1, z, x1, y1, z)
    // v is a frame's own 0-1 (top to bottom); the texture's repeat and offset pick the frame.
    uvs.push(u1, 1, u0, 1, u0, 0, u1, 1, u0, 0, u1, 0)
    geometry.addGroup(i * 6, 6, i % textures.length)
    left -= 0.45
    bottom += 0.45
    halfWidth *= 0.9
    depth -= 0.03
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  const materials = textures.map(({ texture }) => {
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    material.userData.sharedMap = true
    return material
  })
  const mesh = new THREE.Mesh(geometry, materials)
  // Not a body part: no see-through outline and no torch shadow.
  mesh.userData.hasSilhouette = true
  mesh.userData.noShadow = true
  mesh.renderOrder = 1
  const object = new THREE.Group()
  object.add(mesh)

  return {
    object,
    update: (camera, now) => {
      const tick = Math.floor(now * TICKS_PER_SECOND)
      for (const { texture, frames, offset } of textures) {
        texture.offset.y = ((tick + offset) % frames) / frames
      }
      // Face the camera's yaw (not its position), in the parent's frame.
      camera.getWorldDirection(viewDirection)
      facing.setFromAxisAngle(UP, Math.atan2(-viewDirection.x, -viewDirection.z))
      object.parent?.getWorldQuaternion(parentRotation)
      object.quaternion.copy(parentRotation.invert().multiply(facing))
    },
  }
}
