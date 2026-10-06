import * as THREE from 'three'
import { boneGeometry } from './geometry'
import { mobMaterial, type MobModel } from './model'
import { textureFromUrl } from './textures'

// Mojang capes use a 64×32 atlas with a 10×16×1 box. Turn the box so
// the main artwork faces outward on the player's back (+z).
export const createCapeGeometry = () =>
  boneGeometry(
    [{ origin: [-5, -16, -1], size: [10, 16, 1], uv: [0, 0] }],
    new THREE.Vector3(),
    null,
    1 / 64,
    1 / 32
  ).rotateY(Math.PI)

export const addCape = (model: MobModel, url: string, armored = false) => {
  const attachment = model.bones.get('cape')
  if (!attachment) return
  // The jacket ends at z=2.25; chest armor extends to about z=2.5.
  attachment.position.z = armored ? 2.65 : 2.4
  const material = mobMaterial(new THREE.Texture())
  // The temporary map belongs to this material; the loaded map is shared.
  material.userData.sharedMap = false
  const mesh = new THREE.Mesh(createCapeGeometry(), material)
  mesh.castShadow = true
  mesh.visible = false
  attachment.add(mesh)
  model.materials.push(material)
  let disposed = false
  material.addEventListener('dispose', () => {
    disposed = true
  })
  window.electronAPI.bot
    .getSkin(url)
    .then((dataUrl) => {
      if (!dataUrl || disposed) return
      material.map?.dispose()
      material.map = textureFromUrl(dataUrl)
      material.userData.sharedMap = true
      material.needsUpdate = true
      mesh.visible = true
    })
    .catch(() => {})
}

export const animateCape = (cape: THREE.Group, now: number, stride: number, walk: number, delta: number) => {
  const blend = 1 - Math.exp(-Math.min(delta, 0.1) * 8)
  const lift = 0.12 + walk * (0.35 + Math.abs(Math.sin(stride)) * 0.12)
  cape.rotation.x += (-lift + Math.sin(now * 2) * 0.015 - cape.rotation.x) * blend
  cape.rotation.z += (Math.sin(stride) * walk * 0.06 - cape.rotation.z) * blend
}
