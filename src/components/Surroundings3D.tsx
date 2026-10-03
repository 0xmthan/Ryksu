import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Motion, MotionEntity, WorldView } from '../types'
import { prettyName } from '../utils/blockColors'
import { loadBlockAtlas, type BlockAtlas } from '../utils/blockAtlas'
import { buildBlockMeshes } from '../utils/blockMesher'
import { modeFor, type ViewMode } from '../utils/viewMode'
import { createTracked, stepTracked, syncTracked, type Tracked } from './watcher/entityObjects'
import { pickAt, walkTarget, type Pickable } from './watcher/picking'
import { disposeObject, makeLabel } from './watcher/sceneUtils'
import { createSky } from './watcher/sky'
import { createWalkMarker } from './watcher/walkMarker'

type Blocks = WorldView['blocks']

// How quickly shown positions catch up with the latest update (per second); higher is snappier.
const FOLLOW_RATE = 12
// Scene coordinates are world coordinates minus an anchor, to keep float precision far from 0,0.
const REANCHOR_DISTANCE = 2000

type Surroundings3DProps = {
  blocks: Blocks | null
  chest: { x: number; y: number; z: number } | null
  onHover: (text: string | null) => void
  // A click (not a drag) on a block or mob: the world block the bot should walk to.
  onWalkTo: (target: { x: number; y: number; z: number }) => void
  // Sizes the view; the canvas fills it.
  className?: string
}

type SceneState = {
  scene: THREE.Scene
  anchor: THREE.Vector3 | null
  blockGroup: THREE.Group | null
  chestOutline: THREE.Object3D | null
  pickable: Pickable[]
  materials: { opaque: THREE.Material; translucent: THREE.Material; ghost: THREE.Material }
  mode: ViewMode
  // Bumped when the anchor moves, so blocks and the chest get placed again.
  anchorVersion: number
}

const Surroundings3D: React.FC<Surroundings3DProps> = ({
  blocks,
  chest,
  onHover,
  onWalkTo,
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
  const onWalkToRef = useRef(onWalkTo)
  onWalkToRef.current = onWalkTo

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
    const sky = createSky(scene, renderer)
    // Game time of day (ticks), from the latest motion update.
    let timeOfDay = 6000

    // Minecraft and three.js are both Y-up and right-handed, so world axes map straight across.
    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / height(), 0.1, 500)
    camera.position.set(12, 14, 16)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 1, 0)
    controls.enableDamping = true
    controls.maxDistance = 110
    controls.update()

    const state: SceneState = {
      scene,
      anchor: null,
      blockGroup: null,
      chestOutline: null,
      pickable: [],
      anchorVersion: 0,
      // The game's fixed side shading is baked into vertex colors; the sun and shadows come on top.
      materials: {
        opaque: new THREE.MeshLambertMaterial({ vertexColors: true, alphaTest: 0.5 }),
        translucent: new THREE.MeshLambertMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.75,
          depthWrite: false,
        }),
        // A hint of the hidden roof: faint, and never hiding what's under it.
        ghost: new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.14,
          depthWrite: false,
          alphaTest: 0.05,
        }),
      },
      mode: 'full',
    }
    stateRef.current = state

    // The bot is drawn like any other player; the camera follows it.
    let bot: Tracked | null = null
    const walkMarker = createWalkMarker(scene)
    const north = makeLabel('N', '#f87171')
    scene.add(north)
    const entities = new Map<number, Tracked>()
    const clock = new THREE.Clock()

    // Creates, updates or rebuilds (when its look changed) one tracked entity.
    const track = (entity: MotionEntity, existing: Tracked | null | undefined, isBot = false) => {
      const target = new THREE.Vector3(entity.x, entity.y, entity.z).sub(state.anchor!)
      if (existing && syncTracked(existing, entity, target, clock.elapsedTime)) {
        return existing
      }
      const entry = createTracked(entity, target, existing ?? undefined, { bot: isBot })
      scene.add(entry.object)
      return entry
    }

    const handleMotion = (motion: Motion) => {
      timeOfDay = motion.time
      const world = new THREE.Vector3(motion.bot.x, motion.bot.y, motion.bot.z)
      if (!state.anchor || state.anchor.distanceTo(world) > REANCHOR_DISTANCE) {
        const previous = state.anchor
        state.anchor = world.clone().floor()
        if (previous) {
          // Shift everything shown so the view doesn't jump.
          const shift = previous.clone().sub(state.anchor)
          const tracked = [...entities.values(), ...(bot ? [bot] : [])]
          for (const object of [camera, ...tracked.map((entry) => entry.object)]) {
            object.position.add(shift)
          }
          controls.target.add(shift)
          walkMarker.shift(shift)
          for (const entry of tracked) entry.target.add(shift)
        }
        state.anchorVersion++
        setAnchorVersion(state.anchorVersion)
      }

      const firstSight = !bot
      bot = track(
        {
          ...motion.bot,
          id: -1,
          kind: 'player',
          type: 'player',
          item: null,
          name: 'Bot',
          skin: motion.bot.skin ?? undefined,
          slim: motion.bot.slim,
        },
        bot,
        true
      )
      if (firstSight) {
        camera.position.add(bot.target)
        controls.target.add(bot.target)
      }

      const seenIds = new Set<number>()
      for (const entity of motion.entities) {
        seenIds.add(entity.id)
        entities.set(entity.id, track(entity, entities.get(entity.id)))
      }
      for (const [id, entry] of entities) {
        if (!seenIds.has(id)) {
          disposeObject(entry.object)
          entities.delete(id)
        }
      }
    }
    const unsubscribeMotion = window.electronAPI.bot.onMotion(handleMotion)

    const previousBot = new THREE.Vector3()
    let frame = 0
    const render = () => {
      frame = requestAnimationFrame(render)
      const delta = clock.getDelta()
      const now = clock.elapsedTime
      const blend = 1 - Math.exp(-delta * FOLLOW_RATE)

      sky.update(timeOfDay, state.mode, bot ? bot.object.position : controls.target, delta)

      if (bot) {
        previousBot.copy(bot.object.position)
        stepTracked(bot, blend, delta, now)
        // The camera rides along with the bot, keeping whatever angle the user orbited to.
        const moved = bot.object.position.clone().sub(previousBot)
        camera.position.add(moved)
        controls.target.add(moved)
        north.position.set(bot.object.position.x, bot.object.position.y + 1, bot.object.position.z - 20)
      }
      for (const entry of entities.values()) {
        stepTracked(entry, blend, delta, now)
      }
      walkMarker.update(now, bot ? bot.object.position : null)

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

    const pick = (event: PointerEvent) =>
      state.anchor
        ? pickAt(
            event,
            renderer.domElement,
            camera,
            [...(bot ? [bot.object] : []), ...[...entities.values()].map((entry) => entry.object)],
            state.pickable,
            state.anchor
          )
        : null
    const handlePointerMove = (event: PointerEvent) => {
      const picked = pick(event)
      if (!picked) {
        onHoverRef.current(null)
      } else if (picked.kind === 'block') {
        const { x, y, z } = picked.position
        onHoverRef.current(`${prettyName(picked.name)} at ${x} / ${y} / ${z} · click to walk here`)
      } else {
        onHoverRef.current(prettyName(picked.name))
      }
    }
    // A click is a press and release without dragging (dragging orbits the camera).
    let pressed: { x: number; y: number } | null = null
    const handlePointerDown = (event: PointerEvent) => {
      pressed = event.button === 0 ? { x: event.clientX, y: event.clientY } : null
    }
    const handlePointerUp = (event: PointerEvent) => {
      const start = pressed
      pressed = null
      if (!start || event.button !== 0 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) {
        return
      }
      const picked = pick(event)
      if (!picked || !state.anchor) return
      const target = walkTarget(picked)
      walkMarker.show(target.clone().sub(state.anchor), clock.elapsedTime)
      onWalkToRef.current({ x: target.x, y: target.y, z: target.z })
    }
    const handlePointerLeave = () => onHoverRef.current(null)
    renderer.domElement.addEventListener('pointermove', handlePointerMove)
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave)
    renderer.domElement.addEventListener('pointerdown', handlePointerDown)
    renderer.domElement.addEventListener('pointerup', handlePointerUp)

    return () => {
      cancelAnimationFrame(frame)
      unsubscribeMotion()
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointermove', handlePointerMove)
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave)
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
      renderer.domElement.removeEventListener('pointerup', handlePointerUp)
      controls.dispose()
      for (const child of [...scene.children]) {
        disposeObject(child)
      }
      state.materials.opaque.dispose()
      state.materials.translucent.dispose()
      state.materials.ghost.dispose()
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
    const mode = modeFor(blocks.environment)
    state.mode = mode
    const meshes = buildBlockMeshes(blocks, atlas, mode)
    const opaque = new THREE.Mesh(meshes.opaque, state.materials.opaque)
    opaque.castShadow = true
    opaque.receiveShadow = true
    // Water draws after the solid blocks so they show through it.
    const translucent = new THREE.Mesh(meshes.translucent, state.materials.translucent)
    translucent.renderOrder = 1
    translucent.receiveShadow = true
    const ghost = new THREE.Mesh(meshes.ghost, state.materials.ghost)
    ghost.renderOrder = 2
    group.add(opaque, translucent, ghost)
    state.pickable = [
      { mesh: opaque, quads: meshes.opaqueQuads, blocks },
      { mesh: translucent, quads: meshes.translucentQuads, blocks },
    ]

    state.scene.add(group)
    state.blockGroup = group
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks?.key, anchorVersion, atlas])

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
