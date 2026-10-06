import * as THREE from 'three'
import type { MotionEntity } from '../../types'

export const playerHealthText = (health?: number) =>
  typeof health === 'number' && Number.isFinite(health)
    ? String(Math.round(Math.max(0, health) * 10) / 10)
    : '?'

// A shield with a check, in front of trusted players' names: 1 outline, 2 fill, 3 check.
const SHIELD = [
  '111111111',
  '122222221',
  '122222221',
  '122222231',
  '123222321',
  '122323221',
  '012232210',
  '001222100',
  '000111000',
]
const SHIELD_COLORS: Record<string, string> = { '1': '#064e3b', '2': '#34d399', '3': '#ecfdf5' }
const SHIELD_WIDTH = 24

const HEART = [
  '011101110',
  '122212221',
  '122222221',
  '122222221',
  '012222210',
  '001222100',
  '000121000',
  '000010000',
]

export const createPlayerNametag = (entity: MotionEntity) => {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')!
  const makeTexture = () => {
    const made = new THREE.CanvasTexture(canvas)
    made.colorSpace = THREE.SRGBColorSpace
    made.generateMipmaps = false
    made.minFilter = THREE.LinearFilter
    made.magFilter = THREE.LinearFilter
    return made
  }
  let texture = makeTexture()
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  })
  const sprite = new THREE.Sprite(material)
  // Labels do not intercept clicks on the player or the blocks behind them.
  sprite.userData.sharedGeometry = true
  sprite.raycast = () => {}
  sprite.renderOrder = 20
  let signature = '',
    aspect = 1,
    hovered = false,
    current = entity
  const update = (next: MotionEntity) => {
    current = next
    sprite.position.y = next.sleeping != null ? 1.1 : next.crouching ? 2.05 : 2.35
    sprite.visible = !next.dead
    const health = playerHealthText(next.health)
    const trusted = Boolean(next.trusted)
    const key = `${next.name}:${health}:${hovered}:${trusted}`
    if (key === signature) return
    signature = key
    context.font = '600 16px monospace'
    const badge = trusted ? SHIELD_WIDTH : 0
    const width = Math.ceil(
      badge + context.measureText(next.name).width + context.measureText(health).width + 50
    )
    // A texture keeps the size it was first uploaded at, so a wider label (longer health, the trusted
    // badge) needs a new one.
    if (canvas.width !== width * 2 && texture.version > 0) {
      texture.dispose()
      texture = makeTexture()
      material.map = texture
    }
    canvas.width = width * 2
    canvas.height = 64
    context.scale(2, 2)
    context.imageSmoothingEnabled = false
    context.fillStyle = hovered ? 'rgba(12, 30, 38, .9)' : 'rgba(10, 10, 10, .75)'
    context.fillRect(0, 0, width, 32)
    if (hovered) {
      context.strokeStyle = '#7dd3fc'
      context.strokeRect(0.5, 0.5, width - 1, 31)
    }
    context.font = '600 16px monospace'
    context.textBaseline = 'middle'
    if (trusted) {
      for (let y = 0; y < SHIELD.length; y++) {
        for (let x = 0; x < SHIELD[y].length; x++) {
          const pixel = SHIELD[y][x]
          if (pixel === '0') continue
          context.fillStyle = SHIELD_COLORS[pixel]
          context.fillRect(8 + x * 2, 7 + y * 2, 2, 2)
        }
      }
    }
    context.fillStyle = trusted ? '#a7f3d0' : '#fff'
    context.fillText(next.name, 8 + badge, 16)
    const heartX = 18 + badge + context.measureText(next.name).width
    for (let y = 0; y < HEART.length; y++) {
      for (let x = 0; x < HEART[y].length; x++) {
        const pixel = HEART[y][x]
        if (pixel === '0') continue
        context.fillStyle = pixel === '1' ? '#0b090c' : '#593440'
        context.fillRect(heartX + x * 2, 9 + y * 2, 2, 2)
      }
    }
    context.fillStyle = '#8b6572'
    context.fillRect(heartX + 4, 11, 2, 2)
    context.fillStyle = '#e5e5e5'
    context.fillText(health, heartX + 23, 16)
    aspect = width / 32
    sprite.scale.set(0.3 * aspect, 0.3, 1)
    texture.needsUpdate = true
  }
  update(entity)
  return {
    sprite,
    update,
    setHovered(value: boolean) {
      if (value !== hovered) {
        hovered = value
        update(current)
      }
    },
  }
}
export type PlayerNametag = ReturnType<typeof createPlayerNametag>
