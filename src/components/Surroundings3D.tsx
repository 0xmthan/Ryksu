import interactiveBlocks from '../shared/interactiveBlocks.json'
import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { InventoryItem, Motion, MotionEntity, WorldView } from '../types'
import { prettyName } from '../utils/blockColors'
import { loadBlockAtlas, type BlockAtlas } from '../utils/blockAtlas'
import { buildBlockMeshes } from '../utils/blockMesher'
import { modeFor, type ViewMode } from '../utils/viewMode'
import { createTracked, stepTracked, syncTracked, type Tracked } from './watcher/entityObjects'
import { isDoorBlock, pickAt, walkTarget, type Pickable } from './watcher/picking'
import { disposeObject, makeLabel } from './watcher/sceneUtils'
import { createSky } from './watcher/sky'
import { createWalkMarker } from './watcher/walkMarker'
import useManualMovement from '../hooks/useManualMovement'
import { createCameraRig, type CameraMode } from './watcher/cameraRig'
import { createPlayerHover } from './watcher/playerHover'
import HandCard from './watcher/HandCard'
import ArmorSlot from './watcher/ArmorSlot'

type Blocks = WorldView['blocks']

// How quickly shown positions catch up with the latest update (per second); higher is snappier.
const FOLLOW_RATE = 12
// Two clicks on the same entity within this long make a double click (attack).
const DOUBLE_CLICK_MS = 280
// When clicked, the armor pieces start fading in this long after the hand cards.
const ARMOR_DELAY_MS = 180
// Scene coordinates are world coordinates minus an anchor, to keep float precision far from 0,0.
const REANCHOR_DISTANCE = 2000

type Surroundings3DProps = {
  movementEnabled: boolean
  blocks: Blocks | null
  chest: { x: number; y: number; z: number } | null
  onHover: (text: string | null) => void
  // A click (not a drag) on a block or mob: the world block the bot should walk to.
  onWalkTo: (target: { x: number; y: number; z: number; door?: { x: number; y: number; z: number } }) => void
  onBlockInteract: (position: { x: number; y: number; z: number }) => void
  onEntityContext: (entity: MotionEntity, position: { x: number; y: number }) => void
  // What the bot holds, shown at its sides when it's clicked.
  botHands?: { main: InventoryItem; off: InventoryItem }
  // Helmet, chestplate, leggings, boots: shown in an arc over the bot when it's clicked.
  botArmor?: InventoryItem[]
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
  movementEnabled,
  chest,
  onHover,
  onWalkTo,
  onEntityContext,
  onBlockInteract,
  botHands,
  botArmor,
  className = 'relative mt-3 h-[360px] w-full',
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const mainHandRef = useRef<HTMLDivElement>(null)
  const offHandRef = useRef<HTMLDivElement>(null)
  const armorRef = useRef<HTMLDivElement>(null)
  // Clicking the bot shows what it holds and wears.
  const [gearOpen, setGearOpen] = useState(false)
  const gearOpenRef = useRef(gearOpen)
  gearOpenRef.current = gearOpen
  const stateRef = useRef<SceneState | null>(null)
  const movementYaw = useRef(0)
  const movementEnabledRef = useRef(movementEnabled)
  movementEnabledRef.current = movementEnabled
  const cameraRigRef = useRef<ReturnType<typeof createCameraRig> | null>(null)
  const changeCameraMode = (mode: CameraMode) => {
    cameraRigRef.current?.setMode(mode)
  }
  useManualMovement(
    movementEnabled,
    () => movementYaw.current,
    () => {
      changeCameraMode('follow')
      cameraRigRef.current?.recenter()
    }
  )
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
  const onBlockInteractRef = useRef(onBlockInteract)
  onBlockInteractRef.current = onBlockInteract
  const onWalkToRef = useRef(onWalkTo)
  onWalkToRef.current = onWalkTo
  const onEntityContextRef = useRef(onEntityContext)
  onEntityContextRef.current = onEntityContext
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks

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
    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / height(), 0.1, 800)
    camera.position.set(16, 22, 24)
    const playerHover = createPlayerHover(renderer, scene, camera)
    let hoveredPlayer: number | null = null
    let botWalking = false
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 1, 0)
    controls.enableDamping = true
    controls.dampingFactor = 0.09
    controls.rotateSpeed = 0.65
    controls.zoomSpeed = 0.8
    controls.panSpeed = 0.75
    controls.screenSpacePanning = false
    controls.minDistance = 4
    controls.maxDistance = 160
    controls.minPolarAngle = 0.15
    controls.maxPolarAngle = Math.PI / 2 - 0.08
    controls.update()
    const cameraRig = createCameraRig(camera, controls)
    cameraRigRef.current = cameraRig

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
    let entityInfo = new Map<number, MotionEntity>()
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
      botWalking = Boolean(motion.bot.walking)
      entityInfo = new Map(motion.entities.map((entity) => [entity.id, entity]))
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
          cameraRig.reanchor(shift)
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
          name: motion.bot.name ?? 'Bot',
          skin: motion.bot.skin ?? undefined,
      cape: motion.bot.cape ?? undefined,
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

    // Keeps the hand cards beside the bot: the main hand's card on the side of the arm that holds it as
    // the camera sees it, the off hand's on the other, clear of its body.
    const projected = new THREE.Vector3()
    const toScreen = (point: THREE.Vector3) => {
      projected.copy(point).project(camera)
      return { x: ((projected.x + 1) / 2) * container.clientWidth, y: ((1 - projected.y) / 2) * height() }
    }
    const placeHands = () => {
      const cards = [mainHandRef.current, offHandRef.current]
      if (!bot) return
      const yaw = bot.object.rotation.y
      // The model's held-item arm sits on this side of it.
      const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw)).multiplyScalar(0.4)
      const chest = bot.object.position.clone().add(new THREE.Vector3(0, 1.15, 0))
      const center = toScreen(chest)
      const rightX = toScreen(chest.clone().add(right)).x
      const tall = Math.abs(toScreen(chest.clone().setY(chest.y + 0.75)).y - center.y) * 2
      const gap = Math.max(Math.abs(rightX - center.x), tall * 0.3) + 14
      const mainOnRight = rightX >= center.x
      cards.forEach((card, index) => {
        if (!card) return
        const onRight = index === 0 ? mainOnRight : !mainOnRight
        card.dataset.side = onRight ? 'right' : 'left'
        const x = center.x + (onRight ? gap : -gap)
        card.style.transform = `translate(${x}px, ${center.y}px) translate(${onRight ? '0' : '-100%'}, -50%)`
      })
    }

    // Keeps the armor arc centered over the bot's head.
    const placeArmor = () => {
      const arc = armorRef.current
      if (!arc || !bot) return
      const top = toScreen(bot.object.position.clone().add(new THREE.Vector3(0, 2.05, 0)))
      arc.style.transform = `translate(${top.x}px, ${top.y}px) translate(-50%, -100%)`
    }

    let frame = 0
    const render = () => {
      frame = requestAnimationFrame(render)
      const delta = clock.getDelta()
      const now = clock.elapsedTime
      const blend = 1 - Math.exp(-delta * FOLLOW_RATE)

      sky.update(timeOfDay, state.mode, bot ? bot.object.position : controls.target, delta)

      if (bot) {
        stepTracked(bot, blend, delta, now)
        cameraRig.update(bot.object.position, delta)
        const northDistance = (blocksRef.current?.radius ?? 52) + 2
        north.position.set(
          bot.object.position.x,
          bot.object.position.y + 1,
          bot.object.position.z - northDistance
        )
      }
      for (const entry of entities.values()) {
        stepTracked(entry, blend, delta, now)
      }
      walkMarker.update(now, bot ? bot.object.position : null, botWalking)

      controls.update()
      const dx = controls.target.x - camera.position.x
      const dz = controls.target.z - camera.position.z
      if (dx * dx + dz * dz > 0.0001) movementYaw.current = Math.atan2(-dx, -dz)
      const selected = gearOpenRef.current ? bot : hoveredPlayer !== null ? entities.get(hoveredPlayer) : null
      placeHands()
      placeArmor()
      for (const entry of [...entities.values(), ...(bot ? [bot] : [])]) {
        entry.nametag?.setHovered(entry === selected)
      }
      playerHover.render(selected?.model?.root ?? null, delta)
    }
    render()

    const resizeObserver = new ResizeObserver(() => {
      const width = container.clientWidth
      renderer.setSize(width, height())
      playerHover.resize(width, height())
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
      if (pressed && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 5)
        pressed.dragged = true
      const picked = pick(event)
      hoveredPlayer = picked?.kind === 'entity' && picked.id !== null && entityInfo.get(picked.id)?.kind === 'player' ? picked.id : null
      if (!picked) {
        onHoverRef.current(null)
      } else {
        const { x, y, z } = picked.position
        const coordinates = `${Math.floor(x)} / ${Math.floor(y)} / ${Math.floor(z)}`
        const name =
          picked.kind === 'entity' && picked.id !== null && entityInfo.get(picked.id)?.kind === 'player'
            ? picked.name
            : prettyName(picked.name)
        const doorState =
          picked.kind === 'block' && isDoorBlock(picked.name) ? ` · ${picked.open ? 'Open' : 'Closed'}` : ''
        onHoverRef.current(`${name} · ${coordinates}${doorState}`)
      }
    }

    // A click is a press and release without dragging (dragging orbits the camera).
    let pendingClick: { id: number; timer: number } | null = null
    let pressed: { x: number; y: number; button: number; dragged?: boolean } | null = null
    const handlePointerDown = (event: PointerEvent) => {
      pressed =
        event.button === 0 || event.button === 2
          ? { x: event.clientX, y: event.clientY, button: event.button }
          : null
    }
    const handlePointerUp = (event: PointerEvent) => {
      const start = pressed
      pressed = null
      if (
        !start ||
        start.dragged ||
        event.button !== start.button ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5
      ) {
        return
      }
      const picked = pick(event)
      if (!picked || !state.anchor) return
      if (event.button === 2) {
        if (pendingClick) {
          clearTimeout(pendingClick.timer)
          pendingClick = null
        }
        if (picked.kind === 'block' && interactiveBlocks.includes(picked.name)) {
          onBlockInteractRef.current({ x: picked.position.x, y: picked.position.y, z: picked.position.z })
        }
        // Right-clicking a wooden/copper door walks up to it and toggles it (open/close); no walk marker,
        // since the door is the target.
        if (picked.kind === 'block' && isDoorBlock(picked.name) && !picked.name.includes('iron')) {
          changeCameraMode('overview')
          const target = walkTarget(picked)
          onWalkToRef.current({
            x: target.x,
            y: target.y,
            z: target.z,
            door: { x: picked.position.x, y: picked.position.y, z: picked.position.z },
          })
        }
        if (picked.kind === 'entity' && picked.id !== null) {
          const entity = entityInfo.get(picked.id)
          if (entity) onEntityContextRef.current(entity, { x: event.clientX, y: event.clientY })
        }
        return
      }
      // Clicking the bot shows (or hides) its armor; any other click hides it.
      const clickedBot = picked.kind === 'entity' && picked.id === null
      setGearOpen((open) => clickedBot && !open)
      if (clickedBot) return
      const walk = () => {
        if (!state.anchor) return
        changeCameraMode('overview')
        const target = walkTarget(picked)
        walkMarker.show(target.clone().sub(state.anchor), clock.elapsedTime)
        onWalkToRef.current({ x: target.x, y: target.y, z: target.z })
      }
      // Clicking a block walks to it (doors open with a right click).
      if (picked.kind === 'block') {
        changeCameraMode('overview')
        const target = walkTarget(picked)
        walkMarker.show(target.clone().sub(state.anchor), clock.elapsedTime)
        onWalkToRef.current({ x: target.x, y: target.y, z: target.z })
        return
      }
      // On a mob or player, wait a moment for a second click: a double click attacks it instead.
      if (picked.kind === 'entity' && picked.id !== null) {
        if (pendingClick && pendingClick.id === picked.id) {
          clearTimeout(pendingClick.timer)
          pendingClick = null
          window.electronAPI.bot.attackEntity(picked.id).catch(() => {})
          return
        }
        if (pendingClick) clearTimeout(pendingClick.timer)
        pendingClick = {
          id: picked.id,
          timer: window.setTimeout(() => ((pendingClick = null), walk()), DOUBLE_CLICK_MS),
        }
        return
      }
      walk()
    }
    const handlePointerLeave = () => { hoveredPlayer = null; onHoverRef.current(null) }
    const handleContextMenu = (event: MouseEvent) => event.preventDefault()
    const handleCameraKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setGearOpen(false)
      if (
        !movementEnabledRef.current ||
        event.code !== 'KeyF' ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        document.querySelector('[role="dialog"]') ||
        document.activeElement?.closest('input, textarea, select, [contenteditable="true"]')
      )
        return
      event.preventDefault()
      cameraRig.recenter()
    }
    window.addEventListener('keydown', handleCameraKey)
    renderer.domElement.addEventListener('contextmenu', handleContextMenu)
    renderer.domElement.addEventListener('pointermove', handlePointerMove)
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave)
    renderer.domElement.addEventListener('pointerdown', handlePointerDown)
    renderer.domElement.addEventListener('pointerup', handlePointerUp)

    return () => {
      cancelAnimationFrame(frame)
      if (pendingClick) clearTimeout(pendingClick.timer)
      unsubscribeMotion()
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointermove', handlePointerMove)
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave)
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
      renderer.domElement.removeEventListener('pointerup', handlePointerUp)
      renderer.domElement.removeEventListener('contextmenu', handleContextMenu)
      playerHover.dispose()
      cameraRig.dispose()
      controls.dispose()
      cameraRigRef.current = null
      window.removeEventListener('keydown', handleCameraKey)
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
    >
      {botHands
        ? [
            { ref: mainHandRef, label: 'Main hand', item: botHands.main },
            { ref: offHandRef, label: 'Off hand', item: botHands.off },
          ].map(({ ref, label, item }) => (
            <div key={label} ref={ref} className="group pointer-events-none absolute left-0 top-0 z-10">
              {/* The hand cards come first, then the armor. */}
              <div
                className={`transition duration-200 ease-out ${gearOpen ? 'opacity-100' : 'scale-95 opacity-0'}`}
              >
                <HandCard label={label} item={item} />
              </div>
            </div>
          ))
        : null}
      {botArmor ? (
        <div ref={armorRef} className="pointer-events-none absolute left-0 top-0 z-10">
          {/* An arc: the chestplate and leggings ride higher than the helmet and boots at the ends. */}
          <div className="flex items-end gap-2 pb-3">
            {['Helmet', 'Chestplate', 'Leggings', 'Boots'].map((label, index) => (
              <div
                key={label}
                className={`transition duration-200 ease-out ${index === 1 || index === 2 ? '-translate-y-3.5' : ''} ${
                  gearOpen ? 'pointer-events-auto opacity-100' : 'scale-90 opacity-0'
                }`}
                // One by one from the helmet, after the hand cards, when opening; all together when closing.
                style={{ transitionDelay: gearOpen ? `${ARMOR_DELAY_MS + index * 70}ms` : '0ms' }}
              >
                <ArmorSlot index={index} label={label} item={botArmor[index] ?? null} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default Surroundings3D
