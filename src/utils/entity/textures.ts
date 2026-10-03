// Mob, skin and item textures for the watcher, cached and shared: whoever uses one marks its material
// with userData.sharedMap so disposing the mob doesn't free it.
import * as THREE from 'three'
import { entityData } from './data'

export const pixelated = <T extends THREE.Texture>(texture: T) => {
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.flipY = false
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

const urlCache = new Map<string, THREE.Texture>()
// Any image by data URL: a player's skin (fetched by the main process), an item icon, …
export const textureFromUrl = (url: string) => {
  let texture = urlCache.get(url)
  if (!texture) {
    texture = pixelated(new THREE.TextureLoader().load(url))
    urlCache.set(url, texture)
  }
  return texture
}

export const loadTexture = (index: number) => textureFromUrl(entityData.textures[index].src)

const imageCache = new Map<string, Promise<HTMLImageElement>>()
export const loadImage = (src: string) => {
  let image = imageCache.get(src)
  if (!image) {
    image = (async () => {
      const element = new Image()
      element.src = src
      await element.decode()
      return element
    })()
    imageCache.set(src, image)
  }
  return image
}

// Several mob textures drawn over each other into one, the way the game stacks layers (villager outfits,
// horse markings). Missing layers are skipped.
const layeredCache = new Map<string, Promise<THREE.Texture>>()
export const layeredTexture = (indices: (number | null | undefined)[]) => {
  const layers = indices.filter((index): index is number => typeof index === 'number')
  const key = layers.join(',')
  let texture = layeredCache.get(key)
  if (!texture) {
    texture = (async () => {
      const images = await Promise.all(layers.map((index) => loadImage(entityData.textures[index].src)))
      const canvas = document.createElement('canvas')
      canvas.width = images[0].naturalWidth
      canvas.height = images[0].naturalHeight
      const context = canvas.getContext('2d')!
      for (const image of images) {
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
      }
      return pixelated(new THREE.CanvasTexture(canvas))
    })()
    layeredCache.set(key, texture)
  }
  return texture
}

// Villagers wear a biome outfit and a profession outfit over their base skin.
export const villagerTexture = (type: string, villager: { type: number; profession: number }) => {
  const layers = entityData.layers[type]
  return layeredTexture([
    entityData.entities[type].texture,
    layers?.types[villager.type],
    layers?.professions[villager.profession],
  ])
}
