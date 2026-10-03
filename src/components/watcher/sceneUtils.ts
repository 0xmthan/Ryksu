import * as THREE from 'three'

// Frees an object's geometry and materials and takes it out of the scene. Cached item geometry and
// shared textures (marked in userData) stay, since other objects still use them.
export const disposeObject = (root: THREE.Object3D) => {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.userData.sharedGeometry) {
      mesh.geometry?.dispose()
    }
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined
    for (const entry of Array.isArray(material) ? material : material ? [material] : []) {
      if (!entry.userData.sharedMap) {
        ;(entry as THREE.SpriteMaterial).map?.dispose()
      }
      entry.dispose()
    }
  })
  root.removeFromParent()
}

export const makeLabel = (text: string, color: string) => {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')!
  context.fillStyle = color
  context.font = 'bold 44px sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(text, 32, 34)
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false })
  )
  sprite.scale.set(1.6, 1.6, 1)
  return sprite
}

export const shortestAngle = (from: number, to: number) => {
  const difference = (to - from) % (Math.PI * 2)
  return ((difference + Math.PI * 3) % (Math.PI * 2)) - Math.PI
}
