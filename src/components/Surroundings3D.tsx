import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { EntityKind, Motion, WorldView } from '../types'
import { prettyName } from '../utils/blockColors'
import { buildBlockMeshes, loadBlockAtlas, type BlockAtlas } from '../utils/blockMesher'
import {
  animateWalk,
  buildMobModel,
  hasMobModel,
  skinTexture,
  villagerTexture,
  type MobModel,
} from '../utils/entityModels'
import { itemIcon } from '../utils/itemIcons'

type Blocks = WorldView['blocks']

const SKY = '#7ba4ff'
// Distance fog in the sky color softens the hard edge where the loaded blocks end.
const FOG_NEAR = 30
const FOG_FAR = 70
// How quickly shown positions catch up with the latest update (per second); higher is snappier.
const FOLLOW_RATE = 12
// Further than this in one update is a teleport, so jump instead of gliding.
const SNAP_DISTANCE = 8
// Scene coordinates are world coordinates minus an anchor, to keep float precision far from 0,0.
const REANCHOR_DISTANCE = 2000

export const ENTITY_COLORS: Record<EntityKind, string> = {
  player: '#38bdf8',
  hostile: '#ef4444',
  passive: '#facc15',
  item: '#e5e5e5',
}

const ENTITY_SIZES: Record<EntityKind, [number, number, number]> = {
  player: [0.6, 1.8, 0.6],
  hostile: [0.6, 1.8, 0.6],
  passive: [0.9, 0.9, 0.9],
  item: [0.3, 0.3, 0.3],
}

type Tracked = {
  object: THREE.Object3D
  target: THREE.Vector3
  yaw: number
  // Mobs with a real model swing their limbs while moving.
  model: MobModel | null
  stride: number
  walk: number
  // What the entity looks like (type, baby, outfit, skin); the model is rebuilt when it changes.
  look: string
}

const lookOf = (entity: Motion['entities'][number]) =>
  [
    entity.type,
    entity.item,
    entity.baby,
    entity.villager?.type,
    entity.villager?.profession,
    entity.skin,
    entity.slim,
  ].join('|')

// Puts a player's own skin on a model once the main process has fetched it.
const applySkin = (model: MobModel, url: string) => {
  window.electronAPI.bot
    .getSkin(url)
    .then((dataUrl) => {
      if (dataUrl) {
        model.material.map = skinTexture(dataUrl)
        model.material.needsUpdate = true
      }
    })
    .catch(() => {})
}

type Surroundings3DProps = {
  blocks: Blocks | null
  chest: { x: number; y: number; z: number } | null
  hideRoof: boolean
  onHover: (text: string | null) => void
  // Sizes the view; the canvas fills it.
  className?: string
}

const disposeObject = (root: THREE.Object3D) => {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    mesh.geometry?.dispose()
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined
    for (const entry of Array.isArray(material) ? material : material ? [material] : []) {
      // Mob textures are cached and shared between mobs, so they stay.
      if (!entry.userData.sharedMap) {
        ;(entry as THREE.SpriteMaterial).map?.dispose()
      }
      entry.dispose()
    }
  })
  root.removeFromParent()
}

const makeLabel = (text: string, color: string) => {
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

// The bot is drawn as a player, with a small marker floating above its head to tell it apart.
const makeBot = () => {
  const bot = new THREE.Group()
  bot.userData.name = 'Bot'
  const model = hasMobModel('player') ? buildMobModel('player') : null
  if (model) {
    bot.add(model.root)
  } else {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 1.8, 0.6),
      new THREE.MeshLambertMaterial({ color: '#ffffff' })
    )
    body.position.y = 0.9
    bot.add(body)
  }
  const marker = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 0.35, 4),
    new THREE.MeshBasicMaterial({ color: '#38bdf8' })
  )
  marker.rotation.x = Math.PI
  marker.position.y = 2.35
  bot.add(marker)
  return { object: bot, model }
}

const itemSprite = (item: string) => {
  const icon = itemIcon(item)
  if (!icon) return null
  // Block items show their side texture; the sprite always faces the camera like dropped items in game.
  const texture = new THREE.TextureLoader().load(icon.kind === 'flat' ? icon.src : icon.faces[1].src)
  texture.magFilter = THREE.NearestFilter
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, alphaTest: 0.1 }))
  sprite.scale.setScalar(0.4)
  sprite.position.y = 0.25
  return sprite
}

const makeEntity = (entity: Motion['entities'][number]) => {
  const root = new THREE.Group()
  root.userData.name = entity.item ?? entity.name
  const model =
    entity.kind !== 'item' && hasMobModel(entity.type)
      ? buildMobModel(entity.type, { slim: entity.slim })
      : null
  const sprite = entity.kind === 'item' && entity.item ? itemSprite(entity.item) : null
  if (model) {
    root.add(model.root)
    if (entity.baby) {
      model.root.scale.setScalar(0.5)
    }
    if (entity.villager && entity.type) {
      villagerTexture(entity.type, entity.villager)
        .then((texture) => {
          model.material.map = texture
          model.material.needsUpdate = true
        })
        .catch(() => {})
    }
    if (entity.skin) {
      applySkin(model, entity.skin)
    }
  } else if (sprite) {
    root.add(sprite)
  } else {
    // Something without a model (or a mob newer than the generated ones): a colored box.
    const [width, height, depth] = ENTITY_SIZES[entity.kind]
    const geometry = new THREE.BoxGeometry(width, height, depth)
    geometry.translate(0, height / 2, 0)
    root.add(new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: ENTITY_COLORS[entity.kind] })))
  }
  return { object: root, model }
}

const shortestAngle = (from: number, to: number) => {
  const difference = (to - from) % (Math.PI * 2)
  return ((difference + Math.PI * 3) % (Math.PI * 2)) - Math.PI
}

type SceneState = {
  scene: THREE.Scene
  anchor: THREE.Vector3 | null
  blockGroup: THREE.Group | null
  chestOutline: THREE.Object3D | null
  pickable: { mesh: THREE.Mesh; quads: number[]; blocks: Blocks }[]
  materials: { opaque: THREE.Material; translucent: THREE.Material }
  // Bumped when the anchor moves, so blocks and the chest get placed again.
  anchorVersion: number
}

const Surroundings3D: React.FC<Surroundings3DProps> = ({
  blocks,
  chest,
  hideRoof,
  onHover,
  className = 'mt-3 h-[360px] w-full',
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<SceneState | null>(null)
  const [anchorVersion, setAnchorVersion] = useState(0)
  const [atlas, setAtlas] = useState<BlockAtlas | null>(null)

  useEffect(() => {
    let cancelled = false
    loadBlockAtlas().then((loaded) => {
      if (!cancelled) setAtlas(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [])
  const onHoverRef = useRef(onHover)
  onHoverRef.current = onHover

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    const height = () => Math.max(1, container.clientHeight)
    renderer.setSize(container.clientWidth, height())
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(SKY)
    scene.fog = new THREE.Fog(SKY, FOG_NEAR, FOG_FAR)
    scene.add(new THREE.AmbientLight(0xffffff, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.8)
    sun.position.set(6, 12, 4)
    scene.add(sun)

    // Minecraft and three.js are both Y-up and right-handed, so world axes map straight across.
    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / height(), 0.1, 500)
    camera.position.set(12, 14, 16)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 1, 0)
    controls.enableDamping = true
    controls.maxDistance = 80
    controls.update()

    const state: SceneState = {
      scene,
      anchor: null,
      blockGroup: null,
      chestOutline: null,
      pickable: [],
      anchorVersion: 0,
      // Unlit: the side shading is baked into vertex colors, like the game's own block lighting.
      materials: {
        opaque: new THREE.MeshBasicMaterial({ vertexColors: true, alphaTest: 0.5 }),
        translucent: new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.75,
          depthWrite: false,
        }),
      },
    }
    stateRef.current = state

    const made = makeBot()
    const bot = made.object
    let botModel = made.model
    bot.visible = false
    scene.add(bot)
    const botWalk = { stride: 0, walk: 0 }
    let botSkin: string | null = null
    let botSlim = false
    const botTarget = { position: new THREE.Vector3(), yaw: 0, seen: false }
    const north = makeLabel('N', '#f87171')
    scene.add(north)
    const entities = new Map<number, Tracked>()

    const handleMotion = (motion: Motion) => {
      const world = new THREE.Vector3(motion.bot.x, motion.bot.y, motion.bot.z)
      if (!state.anchor || state.anchor.distanceTo(world) > REANCHOR_DISTANCE) {
        const previous = state.anchor
        state.anchor = world.clone().floor()
        if (previous) {
          // Shift everything shown so the view doesn't jump.
          const shift = previous.clone().sub(state.anchor)
          for (const object of [bot, camera, ...[...entities.values()].map((entry) => entry.object)]) {
            object.position.add(shift)
          }
          controls.target.add(shift)
          for (const entry of entities.values()) entry.target.add(shift)
        }
        state.anchorVersion++
        setAnchorVersion(state.anchorVersion)
      }
      const local = world.sub(state.anchor)
      botTarget.position.copy(local)
      botTarget.yaw = motion.bot.yaw
      if (botModel && motion.bot.skin && motion.bot.skin !== botSkin) {
        botSkin = motion.bot.skin
        // Slim and wide skins need different arms, so swap the model before putting the skin on.
        if (motion.bot.slim !== botSlim) {
          botSlim = motion.bot.slim
          const nextModel = buildMobModel('player', { slim: botSlim })
          disposeObject(botModel.root)
          bot.add(nextModel.root)
          botModel = nextModel
        }
        applySkin(botModel, botSkin)
      }
      if (!botTarget.seen) {
        botTarget.seen = true
        bot.visible = true
        bot.position.copy(local)
        bot.rotation.y = motion.bot.yaw
        camera.position.add(local)
        controls.target.add(local)
      }

      const seenIds = new Set<number>()
      for (const entity of motion.entities) {
        seenIds.add(entity.id)
        const target = new THREE.Vector3(entity.x, entity.y, entity.z).sub(state.anchor)
        const look = lookOf(entity)
        const existing = entities.get(entity.id)
        if (existing && existing.look === look) {
          existing.target.copy(target)
          existing.yaw = entity.yaw
          continue
        }
        const { object, model } = makeEntity(entity)
        object.position.copy(existing ? existing.object.position : target)
        object.rotation.y = existing ? existing.object.rotation.y : entity.yaw
        if (existing) {
          disposeObject(existing.object)
        }
        scene.add(object)
        entities.set(entity.id, { object, target, yaw: entity.yaw, model, stride: 0, walk: 0, look })
      }
      for (const [id, entry] of entities) {
        if (!seenIds.has(id)) {
          disposeObject(entry.object)
          entities.delete(id)
        }
      }
    }
    const unsubscribeMotion = window.electronAPI.bot.onMotion(handleMotion)

    const before = new THREE.Vector3()
    // Moves an object toward its latest position and swings its limbs by how far it went.
    const glide = (
      object: THREE.Object3D,
      target: THREE.Vector3,
      yaw: number,
      blend: number,
      delta: number,
      walker: { stride: number; walk: number },
      model: MobModel | null
    ) => {
      before.copy(object.position)
      if (object.position.distanceTo(target) > SNAP_DISTANCE) {
        object.position.copy(target)
      } else {
        object.position.lerp(target, blend)
      }
      object.rotation.y += shortestAngle(object.rotation.y, yaw) * blend
      if (model) {
        const moved = Math.hypot(object.position.x - before.x, object.position.z - before.z)
        const speed = delta > 0 && moved < SNAP_DISTANCE ? moved / delta : 0
        walker.stride += moved < SNAP_DISTANCE ? moved * 3 : 0
        walker.walk += (Math.min(1, speed / 3) - walker.walk) * blend
        animateWalk(model, walker.stride, walker.walk)
      }
    }

    const clock = new THREE.Clock()
    const previousBot = new THREE.Vector3()
    let frame = 0
    const render = () => {
      frame = requestAnimationFrame(render)
      const delta = clock.getDelta()
      const blend = 1 - Math.exp(-delta * FOLLOW_RATE)

      if (botTarget.seen) {
        previousBot.copy(bot.position)
        glide(bot, botTarget.position, botTarget.yaw, blend, delta, botWalk, botModel)
        // The camera rides along with the bot, keeping whatever angle the user orbited to.
        const moved = bot.position.clone().sub(previousBot)
        camera.position.add(moved)
        controls.target.add(moved)
        north.position.set(bot.position.x, bot.position.y + 1, bot.position.z - 13.5)
      }
      for (const entry of entities.values()) {
        glide(entry.object, entry.target, entry.yaw, blend, delta, entry, entry.model)
      }

      controls.update()
      renderer.render(scene, camera)
    }
    render()

    const resizeObserver = new ResizeObserver(() => {
      const width = container.clientWidth
      renderer.setSize(width, height())
      camera.aspect = width / height()
      camera.updateProjectionMatrix()
    })
    resizeObserver.observe(container)

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const handlePointerMove = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      )
      raycaster.setFromCamera(pointer, camera)
      const targets: THREE.Object3D[] = [
        bot,
        ...[...entities.values()].map((entry) => entry.object),
        ...state.pickable.map((entry) => entry.mesh),
      ]
      const hit = raycaster.intersectObjects(targets, true)[0]
      if (!hit) {
        onHoverRef.current(null)
        return
      }
      const picked = state.pickable.find((entry) => entry.mesh === hit.object)
      if (picked && hit.faceIndex != null) {
        // Two triangles per quad.
        const index = picked.quads[Math.floor(hit.faceIndex / 2)]
        const { origin, palette, positions } = picked.blocks
        onHoverRef.current(
          `${prettyName(palette[picked.blocks.blocks[index]])} at ${origin.x + positions[index * 3]} / ${
            origin.y + positions[index * 3 + 1]
          } / ${origin.z + positions[index * 3 + 2]}`
        )
        return
      }
      let object: THREE.Object3D | null = hit.object
      while (object && !object.userData.name) {
        object = object.parent
      }
      onHoverRef.current(object ? prettyName(String(object.userData.name)) : null)
    }
    const handlePointerLeave = () => onHoverRef.current(null)
    renderer.domElement.addEventListener('pointermove', handlePointerMove)
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave)

    return () => {
      cancelAnimationFrame(frame)
      unsubscribeMotion()
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointermove', handlePointerMove)
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave)
      controls.dispose()
      for (const child of [...scene.children]) {
        disposeObject(child)
      }
      state.materials.opaque.dispose()
      state.materials.translucent.dispose()
      renderer.dispose()
      container.removeChild(renderer.domElement)
      stateRef.current = null
    }
  }, [])

  // Blocks only arrive a couple of times a second and are only rebuilt when something changed.
  useEffect(() => {
    const state = stateRef.current
    if (!state?.anchor || !blocks || !atlas) {
      return
    }
    if (state.blockGroup) {
      // The materials and atlas are shared across rebuilds; only the geometry is thrown away.
      state.blockGroup.traverse((object) => (object as THREE.Mesh).geometry?.dispose())
      state.blockGroup.removeFromParent()
    }

    const group = new THREE.Group()
    group.position.set(
      blocks.origin.x - state.anchor.x,
      blocks.origin.y - state.anchor.y,
      blocks.origin.z - state.anchor.z
    )
    for (const material of Object.values(state.materials) as THREE.MeshBasicMaterial[]) {
      if (material.map !== atlas.texture) {
        material.map = atlas.texture
        material.needsUpdate = true
      }
    }
    const meshes = buildBlockMeshes(blocks, atlas, hideRoof)
    const opaque = new THREE.Mesh(meshes.opaque, state.materials.opaque)
    // Water draws after the solid blocks so they show through it.
    const translucent = new THREE.Mesh(meshes.translucent, state.materials.translucent)
    translucent.renderOrder = 1
    group.add(opaque, translucent)
    state.pickable = [
      { mesh: opaque, quads: meshes.opaqueQuads, blocks },
      { mesh: translucent, quads: meshes.translucentQuads, blocks },
    ]

    state.scene.add(group)
    state.blockGroup = group
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks?.key, hideRoof, anchorVersion, atlas])

  useEffect(() => {
    const state = stateRef.current
    if (!state?.anchor) {
      return
    }
    if (state.chestOutline) {
      disposeObject(state.chestOutline)
      state.chestOutline = null
    }
    if (!chest) {
      return
    }
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.06, 1.06, 1.06)),
      new THREE.LineBasicMaterial({ color: '#fbbf24' })
    )
    outline.position.set(
      chest.x - state.anchor.x + 0.5,
      chest.y - state.anchor.y + 0.5,
      chest.z - state.anchor.z + 0.5
    )
    state.scene.add(outline)
    state.chestOutline = outline
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chest?.x, chest?.y, chest?.z, anchorVersion])

  return (
    <div
      ref={containerRef}
      className={`${className} cursor-grab overflow-hidden rounded-md active:cursor-grabbing`}
    />
  )
}

export default Surroundings3D
