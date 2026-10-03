import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { EntityKind, Motion, WorldView } from '../types'
import { blockColor, prettyName } from '../utils/blockColors'

type Blocks = WorldView['blocks']

const LIQUIDS = new Set(['water', 'lava'])
// With the roof hidden, blocks this high above the bot's feet and up are left out so caves stay visible.
const ROOF_CUTOFF = 2
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

type Tracked = { object: THREE.Object3D; target: THREE.Vector3; yaw: number }

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
      ;(entry as THREE.SpriteMaterial).map?.dispose()
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

const makeBot = () => {
  // A nose points where the bot looks. Yaw 0 faces north (-Z), same as three.js rotation.y.
  const bot = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 1.8, 0.6),
    new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#334155' })
  )
  body.position.y = 0.9
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.6, 12),
    new THREE.MeshBasicMaterial({ color: '#38bdf8' })
  )
  nose.rotation.x = -Math.PI / 2
  nose.position.set(0, 1.5, -0.55)
  bot.add(body, nose)
  bot.userData.name = 'Bot'
  return bot
}

const makeEntity = (kind: EntityKind, name: string) => {
  const [width, height, depth] = ENTITY_SIZES[kind]
  const geometry = new THREE.BoxGeometry(width, height, depth)
  geometry.translate(0, height / 2, 0)
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: ENTITY_COLORS[kind] }))
  mesh.userData.name = name
  return mesh
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
  pickable: { mesh: THREE.InstancedMesh; names: string[]; positions: THREE.Vector3[] }[]
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
    scene.background = new THREE.Color('#0a0a0a')
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
    }
    stateRef.current = state

    const bot = makeBot()
    bot.visible = false
    scene.add(bot)
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
        const existing = entities.get(entity.id)
        if (existing) {
          existing.target.copy(target)
          existing.yaw = entity.yaw
          continue
        }
        const object = makeEntity(entity.kind, entity.name)
        object.position.copy(target)
        object.rotation.y = entity.yaw
        scene.add(object)
        entities.set(entity.id, { object, target, yaw: entity.yaw })
      }
      for (const [id, entry] of entities) {
        if (!seenIds.has(id)) {
          disposeObject(entry.object)
          entities.delete(id)
        }
      }
    }
    const unsubscribeMotion = window.electronAPI.bot.onMotion(handleMotion)

    const glide = (object: THREE.Object3D, target: THREE.Vector3, yaw: number, blend: number) => {
      if (object.position.distanceTo(target) > SNAP_DISTANCE) {
        object.position.copy(target)
      } else {
        object.position.lerp(target, blend)
      }
      object.rotation.y += shortestAngle(object.rotation.y, yaw) * blend
    }

    const clock = new THREE.Clock()
    const previousBot = new THREE.Vector3()
    let frame = 0
    const render = () => {
      frame = requestAnimationFrame(render)
      const blend = 1 - Math.exp(-clock.getDelta() * FOLLOW_RATE)

      if (botTarget.seen) {
        previousBot.copy(bot.position)
        glide(bot, botTarget.position, botTarget.yaw, blend)
        // The camera rides along with the bot, keeping whatever angle the user orbited to.
        const moved = bot.position.clone().sub(previousBot)
        camera.position.add(moved)
        controls.target.add(moved)
        north.position.set(bot.position.x, bot.position.y + 1, bot.position.z - 13.5)
      }
      for (const entry of entities.values()) {
        glide(entry.object, entry.target, entry.yaw, blend)
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
      const block = state.pickable.find((entry) => entry.mesh === hit.object)
      if (block && hit.instanceId !== undefined) {
        const position = block.positions[hit.instanceId]
        onHoverRef.current(
          `${prettyName(block.names[hit.instanceId])} at ${position.x} / ${position.y} / ${position.z}`
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
      renderer.dispose()
      container.removeChild(renderer.domElement)
      stateRef.current = null
    }
  }, [])

  // Blocks only arrive a couple of times a second and are only rebuilt when something changed.
  useEffect(() => {
    const state = stateRef.current
    if (!state?.anchor || !blocks) {
      return
    }
    if (state.blockGroup) {
      disposeObject(state.blockGroup)
    }
    state.pickable = []

    const { origin, palette, positions } = blocks
    const group = new THREE.Group()
    group.position.set(origin.x - state.anchor.x, origin.y - state.anchor.y, origin.z - state.anchor.z)

    const solids: { x: number; y: number; z: number; name: string }[] = []
    const liquids: typeof solids = []
    for (let i = 0; i < blocks.blocks.length; i++) {
      const y = positions[i * 3 + 1]
      if (hideRoof && y >= ROOF_CUTOFF) {
        continue
      }
      const name = palette[blocks.blocks[i]]
      const entry = { x: positions[i * 3], y, z: positions[i * 3 + 2], name }
      ;(LIQUIDS.has(name) ? liquids : solids).push(entry)
    }

    const matrix = new THREE.Matrix4()
    const color = new THREE.Color()
    const addBlocks = (list: typeof solids, material: THREE.Material) => {
      if (list.length === 0) {
        material.dispose()
        return
      }
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, list.length)
      list.forEach((block, index) => {
        matrix.makeTranslation(block.x + 0.5, block.y + 0.5, block.z + 0.5)
        mesh.setMatrixAt(index, matrix)
        // A slight darkening with depth makes layers easier to tell apart.
        const depthShade = Math.max(0.55, Math.min(1.1, 1 + block.y * 0.04))
        mesh.setColorAt(index, color.set(blockColor(block.name)).multiplyScalar(depthShade))
      })
      group.add(mesh)
      state.pickable.push({
        mesh,
        names: list.map((block) => block.name),
        positions: list.map(
          (block) => new THREE.Vector3(origin.x + block.x, origin.y + block.y, origin.z + block.z)
        ),
      })
    }
    addBlocks(solids, new THREE.MeshLambertMaterial())
    addBlocks(liquids, new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.55, depthWrite: false }))

    state.scene.add(group)
    state.blockGroup = group
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks?.key, hideRoof, anchorVersion])

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
