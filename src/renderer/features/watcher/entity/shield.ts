import * as THREE from 'three'
import shield from '../../../../generated/shieldModel.json'
import { boneGeometry } from './geometry'
import { mobMaterial } from './model'
import { textureFromUrl } from './textures'

// Native shield dimensions in model pixels, rather than a scaled inventory sprite.
export const createShieldGeometry = () =>
  boneGeometry(shield.cubes, new THREE.Vector3(), null, 1 / shield.width, 1 / shield.height)

export const buildHeldShield = (side: 1 | -1) => {
  const holder = new THREE.Group()
  holder.name = 'shield-grip'
  // Keep the handle in the palm and the plate outside the forearm. Mirror the
  // grip for the other hand; a slight inward angle shows the face from the front.
  holder.position.x = side * 2
  holder.rotation.y = -side * THREE.MathUtils.degToRad(75)
  const mesh = new THREE.Mesh(createShieldGeometry(), mobMaterial(textureFromUrl(shield.texture)))
  mesh.name = 'shield'
  mesh.position.y = -2
  mesh.castShadow = true
  holder.add(mesh)
  return holder
}
