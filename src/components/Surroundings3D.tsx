import interactiveBlocks from '../shared/interactiveBlocks.json'
import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { BuildAction, BuildCells, InventoryItem, Motion, MotionEntity, WorldView } from '../types'
import { prettyName } from '../utils/blockColors'
import { loadBlockAtlas, type BlockAtlas } from '../utils/blockAtlas'
import { buildBlockMeshes } from '../utils/blockMesher'
import { modeFor, type ViewMode } from '../utils/viewMode'
import { createTracked, stepTracked, syncTracked, type Tracked } from './watcher/entityObjects'
import { groundTarget, isDoorBlock, isLiquid, pickAt, REPLACEABLE_BLOCKS, walkTarget, type Pick, type Pickable } from './watcher/picking'
import { disposeObject, makeLabel } from './watcher/sceneUtils'
import { createSky } from './watcher/sky'
import { applyBlockLight } from './watcher/blockLight'
import { createWalkMarker } from './watcher/walkMarker'
import useManualMovement from '../hooks/useManualMovement'
import { createCameraRig, type CameraMode } from './watcher/cameraRig'
import { createPlayerHover } from './watcher/playerHover'
import HandCard from './watcher/HandCard'
import ArmorSlot from './watcher/ArmorSlot'
import { createBuildPreview, type BuildLineMode } from './watcher/buildPreview'
import {
  applySeeThrough,
  getSeeThroughShape,
  HOLOGRAM_OPACITY,
  isSeeThrough,
  SEE_THROUGH_SHAPES,
  setSeeThroughShape,
  updateSeeThrough,
} from './watcher/seeThrough'

type Blocks = WorldView['blocks']

// How quickly shown positions catch up with the latest update (per second); higher is snappier.
const FOLLOW_RATE = 12
// Two clicks on the same entity within this long make a double click (attack).
const DOUBLE_CLICK_MS = 280
// When clicked, the armor pieces start fading in this long after the hand cards.
const ARMOR_DELAY_MS = 180
// The longest line one build drag makes (the bot side caps it too).
const MAX_BUILD_LINE = 32
// Scene coordinates are world coordinates minus an anchor, to keep float precision far from 0,0.
const REANCHOR_DISTANCE = 2000
// How bright the ground under a see-through block is drawn (linear, 1 = as normal).
const CAP_SHADE = new THREE.Color().setRGB(0.4, 0.4, 0.4)

type Surroundings3DProps = {
  movementEnabled: boolean
  blocks: Blocks | null
  // Auto Mine's deposit chests, outlined.
  chests: { x: number; y: number; z: number }[]
  // While set, a click on a block calls this instead of walking or opening it.
  onBlockPick?: ((block: { x: number; y: number; z: number; name: string }) => void) | null
  onHover: (text: string | null) => void
  // A click (not a drag) on a block or mob: the world block the bot should walk to.
  onWalkTo: (target: { x: number; y: number; z: number; door?: { x: number; y: number; z: number } }) => void
  onBlockInteract: (position: { x: number; y: number; z: number }) => void
  onEntityContext: (entity: MotionEntity, position: { x: number; y: number }) => void
  // What the bot holds, shown at its sides when it's clicked.
  botHands?: { main: InventoryItem; off: InventoryItem }
  // Helmet, chestplate, leggings, boots: shown in an arc over the bot when it's clicked.
  botArmor?: InventoryItem[]
  // Build mode: left click breaks the block under the mouse, right click places the held block (`heldBlock`,
  // shown as a see-through preview) against the face under it. Null when what's held can't be placed.
  buildMode?: boolean
  heldBlock?: string | null
  onBuild?: (action: BuildAction) => void
  // Blocks the bot is still to break or place, marked until they're done.
  queuedBuild?: BuildCells | null
  // Sizes the view; the canvas fills it.
  className?: string
}

type SceneState = {
  scene: THREE.Scene
  anchor: THREE.Vector3 | null
  blockGroup: THREE.Group | null
  chestOutlines: THREE.Object3D[]
  pickable: Pickable[]
  materials: { opaque: THREE.Material; translucent: THREE.Material; ghost: THREE.Material; hologram: THREE.Material; cap: THREE.Material }
  mode: ViewMode
  // Bumped when the anchor moves, so blocks and the chest get placed again.
  anchorVersion: number
}

const Surroundings3D: React.FC<Surroundings3DProps> = ({
  blocks,
  movementEnabled,
  chests,
  onBlockPick = null,
  onHover,
  onWalkTo,
  onEntityContext,
  onBlockInteract,
  botHands,
  botArmor,
  buildMode = false,
  heldBlock = null,
  onBuild,
  queuedBuild = null,
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
  const onBlockPickRef = useRef(onBlockPick)
  onBlockPickRef.current = onBlockPick
  const onWalkToRef = useRef(onWalkTo)
  onWalkToRef.current = onWalkTo
  const buildModeRef = useRef(buildMode)
  buildModeRef.current = buildMode
  const heldBlockRef = useRef(heldBlock)
  heldBlockRef.current = heldBlock
  const onBuildRef = useRef(onBuild)
  onBuildRef.current = onBuild
  const buildPreviewRef = useRef<ReturnType<typeof createBuildPreview> | null>(null)
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
    // The middle button (wheel press) turns the camera, like a left drag; the wheel itself zooms.
    controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE
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
      chestOutlines: [],
      pickable: [],
      anchorVersion: 0,
      // The game's fixed side shading is baked into vertex colors; the sun and shadows come on top.
      materials: {
        opaque: new THREE.MeshLambertMaterial({ vertexColors: true, alphaTest: 0.5 }),
        // Writes depth so only the nearest water surface shows, not every face of the water behind it.
        translucent: new THREE.MeshLambertMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.75,
          depthWrite: true,
        }),
        // A hint of the hidden roof: faint, and never hiding what's under it.
        ghost: new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.14,
          depthWrite: false,
          alphaTest: 0.05,
        }),
        // Blocks between the camera and the bot, see-through so the bot shows (see watcher/seeThrough.ts).
        hologram: new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: HOLOGRAM_OPACITY,
          depthWrite: false,
          alphaTest: 0.05,
        }),
        // The tops of blocks under a hologram, darkened like a cut-away floor.
        cap: new THREE.MeshLambertMaterial({ vertexColors: true, alphaTest: 0.5, color: CAP_SHADE }),
      },
      mode: 'full',
    }
    stateRef.current = state
    applySeeThrough(state.materials.opaque, 'solid')
    applySeeThrough(state.materials.hologram, 'hologram')
    applySeeThrough(state.materials.cap, 'cap')
    applyBlockLight(state.materials.opaque)
    applyBlockLight(state.materials.translucent)
    applyBlockLight(state.materials.cap)

    // The bot is drawn like any other player; the camera follows it.
    let bot: Tracked | null = null
    const walkMarker = createWalkMarker(scene)
    const buildPreview = createBuildPreview(scene)
    buildPreviewRef.current = buildPreview
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
          buildPreview.shift()
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
      buildPreview.update(now)

      controls.update()
      updateSeeThrough(camera, bot ? bot.object.position : null)
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

    const pick = (event: PointerEvent, skipBlock?: (name: string) => boolean) =>
      state.anchor
        ? pickAt(
            event,
            renderer.domElement,
            camera,
            [...(bot ? [bot.object] : []), ...[...entities.values()].map((entry) => entry.object)],
            state.pickable,
            state.anchor,
            skipBlock,
            (position) => isSeeThrough(position.clone().sub(state.anchor!))
          )
        : null
    // Build mode targets. Placing goes into water, lava or plants under the mouse (replacing them), else
    // onto the face pointed at; breaking looks through water and lava to the block behind.
    const placeSpot = (picked: Pick | null) => {
      if (picked?.kind !== 'block') return null
      return REPLACEABLE_BLOCKS.has(picked.name)
        ? { cell: picked.position.clone(), face: null }
        : { cell: picked.position.clone().add(picked.normal), face: picked.normal.clone() }
    }
    const breakPick = (event: PointerEvent) => {
      const picked = pick(event, isLiquid)
      return picked?.kind === 'block' ? picked : null
    }
    const handlePointerMove = (event: PointerEvent) => {
      if (pressed && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 5)
        pressed.dragged = true
      if (buildDrag) {
        buildDrag.end = buildDragEnd(event, buildDrag)
        const cells = showBuildLine()
        const held = heldBlockRef.current ? prettyName(heldBlockRef.current) : 'blocks'
        onHoverRef.current(
          buildDrag.mode === 'place'
            ? `Place ${cells} × ${held}`
            : `Break ${cells} block${cells === 1 ? '' : 's'}`
        )
        return
      }
      const picked = pick(event)
      if (buildModeRef.current && picked?.kind === 'block' && state.anchor) {
        const anchor = state.anchor
        const target = breakPick(event)
        const spot = placeSpot(picked)
        buildPreview.show(target ? target.position.clone().sub(anchor) : null, spot ? spot.cell.sub(anchor) : null)
      } else {
        buildPreview.hide()
      }
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
    // Build mode drags: a line from the block (breaking) or free spot (placing) pressed on to the one under
    // the mouse, kept to whichever axis it moved along most. Takes over from the camera while it lasts.
    type BuildDrag = {
      mode: BuildLineMode
      button: number
      start: THREE.Vector3
      end: THREE.Vector3
      face: THREE.Vector3 | null
    }
    let buildDrag: BuildDrag | null = null
    const lineCells = ({ start, end }: BuildDrag) => {
      const delta = end.clone().sub(start)
      const axis = (['x', 'y', 'z'] as const).reduce((best, key) =>
        Math.abs(delta[key]) > Math.abs(delta[best]) ? key : best
      )
      const length = Math.min(Math.abs(delta[axis]), MAX_BUILD_LINE - 1)
      const step = Math.sign(delta[axis])
      return Array.from({ length: length + 1 }, (_, index) => {
        const cell = start.clone()
        cell[axis] += step * index
        return cell
      })
    }
    // Where the line ends: the free spot (placing) or block (breaking) under the mouse, or over empty space,
    // the spot at the line's height under it.
    const dragRay = new THREE.Raycaster()
    const dragPointer = new THREE.Vector2()
    const buildDragEnd = (event: PointerEvent, drag: BuildDrag) => {
      const picked = drag.mode === 'place' ? pick(event) : breakPick(event)
      if (picked?.kind === 'block') {
        return drag.mode === 'place' ? placeSpot(picked)!.cell : picked.position.clone()
      }
      if (!state.anchor) return drag.end
      const rect = renderer.domElement.getBoundingClientRect()
      dragPointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      )
      dragRay.setFromCamera(dragPointer, camera)
      const level = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(drag.start.y - state.anchor.y + 0.5))
      const hit = dragRay.ray.intersectPlane(level, new THREE.Vector3())
      return hit ? hit.add(state.anchor).floor().setY(drag.start.y) : drag.end
    }
    const showBuildLine = () => {
      if (!buildDrag || !state.anchor) return 0
      const anchor = state.anchor
      const cells = lineCells(buildDrag)
      buildPreview.showLine(
        cells.map((cell) => cell.clone().sub(anchor)),
        buildDrag.mode
      )
      return cells.length
    }
    const endBuildDrag = () => {
      buildDrag = null
      controls.enabled = true
      buildPreview.hide()
      onHoverRef.current(null)
    }
    // On the container in the capture phase, so it runs before the camera controls' own pointerdown.
    const handleBuildPointerDown = (event: PointerEvent) => {
      if (!buildModeRef.current || onBlockPickRef.current || (event.button !== 0 && event.button !== 2)) return
      if (event.button === 2 && !heldBlockRef.current) return
      const mode: BuildLineMode = event.button === 2 ? 'place' : 'break'
      const picked = mode === 'place' ? pick(event) : breakPick(event)
      if (picked?.kind !== 'block' || !state.anchor) return
      const spot = mode === 'place' ? placeSpot(picked)! : { cell: picked.position.clone(), face: null }
      buildDrag = { mode, button: event.button, start: spot.cell, end: spot.cell.clone(), face: spot.face }
      controls.enabled = false
      renderer.domElement.setPointerCapture?.(event.pointerId)
      showBuildLine()
    }

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
      if (buildDrag) {
        if (event.button !== buildDrag.button) return
        const drag = buildDrag
        endBuildDrag()
        // Build mode was switched off mid-drag.
        if (!buildModeRef.current) return
        const cells = lineCells(drag).map(({ x, y, z }) => ({ x, y, z }))
        onBuildRef.current?.(
          drag.mode === 'place' && drag.face
            ? { type: 'place', cells, face: { x: drag.face.x, y: drag.face.y, z: drag.face.z } }
            : { type: drag.mode, cells }
        )
        return
      }
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
      if (onBlockPickRef.current) {
        if (picked.kind === 'block') {
          const { x, y, z } = picked.position
          onBlockPickRef.current({ x, y, z, name: picked.name })
        }
        return
      }
      // Build mode clicks on blocks are one-block drags (handled above); a right click with nothing
      // placeable in hand does nothing.
      if (buildModeRef.current && picked.kind === 'block') return
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
      // Clicking a block walks to it (doors open with a right click); clicking a wall, to the ground below.
      if (picked.kind === 'block') {
        changeCameraMode('overview')
        const target = groundTarget(picked, blocksRef.current)
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
    const handlePointerLeave = () => { hoveredPlayer = null; buildPreview.hide(); onHoverRef.current(null) }
    const handleContextMenu = (event: MouseEvent) => event.preventDefault()
    const handleCameraKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setGearOpen(false)
      if (event.key === 'Escape' && buildDrag) {
        event.stopImmediatePropagation()
        endBuildDrag()
        return
      }
      // H cycles how blocks in front of the bot turn see-through.
      if (
        event.code === 'KeyH' &&
        !event.repeat &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !document.activeElement?.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        const next =
          SEE_THROUGH_SHAPES[(SEE_THROUGH_SHAPES.indexOf(getSeeThroughShape()) + 1) % SEE_THROUGH_SHAPES.length]
        setSeeThroughShape(next)
        onHoverRef.current(`See-through: ${next}`)
        return
      }
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
    container.addEventListener('pointerdown', handleBuildPointerDown, true)
    renderer.domElement.addEventListener('pointerup', handlePointerUp)

    return () => {
      cancelAnimationFrame(frame)
      if (pendingClick) clearTimeout(pendingClick.timer)
      unsubscribeMotion()
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointermove', handlePointerMove)
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave)
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
      container.removeEventListener('pointerdown', handleBuildPointerDown, true)
      renderer.domElement.removeEventListener('pointerup', handlePointerUp)
      renderer.domElement.removeEventListener('contextmenu', handleContextMenu)
      playerHover.dispose()
      buildPreview.dispose()
      buildPreviewRef.current = null
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
      state.materials.hologram.dispose()
      state.materials.cap.dispose()
      renderer.dispose()
      container.removeChild(renderer.domElement)
      stateRef.current = null
    }
  }, [])

  useEffect(() => buildPreviewRef.current?.setItem(heldBlock), [heldBlock])
  // Re-placed when the view re-anchors, since these are in world coordinates.
  useEffect(() => {
    const anchor = stateRef.current?.anchor
    const preview = buildPreviewRef.current
    if (!preview) return
    const toScene = (cells: { x: number; y: number; z: number }[]) =>
      anchor ? cells.map(({ x, y, z }) => new THREE.Vector3(x, y, z).sub(anchor)) : []
    preview.setQueued(toScene(queuedBuild?.break ?? []), toScene(queuedBuild?.place ?? []))
  }, [queuedBuild, anchorVersion])
  useEffect(() => {
    if (!buildMode) buildPreviewRef.current?.hide()
  }, [buildMode])

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
    // The same solid blocks again, drawing only the ones covering the bot.
    const hologram = new THREE.Mesh(meshes.opaque, state.materials.hologram)
    hologram.renderOrder = 3
    const caps = new THREE.Mesh(meshes.caps, state.materials.cap)
    caps.receiveShadow = true
    group.add(opaque, translucent, ghost, hologram, caps)
    state.pickable = [
      { mesh: opaque, quads: meshes.opaqueQuads, blocks },
      { mesh: translucent, quads: meshes.translucentQuads, blocks },
      { mesh: caps, quads: meshes.capQuads, blocks },
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
    for (const outline of state.chestOutlines) disposeObject(outline)
    state.chestOutlines = chests.map((chest) => {
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1.06, 1.06, 1.06)),
        new THREE.LineBasicMaterial({ color: '#fbbf24' })
      )
      outline.position.set(
        chest.x - state.anchor!.x + 0.5,
        chest.y - state.anchor!.y + 0.5,
        chest.z - state.anchor!.z + 0.5
      )
      state.scene.add(outline)
      return outline
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chests.map((chest) => `${chest.x},${chest.y},${chest.z}`).join(';'), anchorVersion])

  return (
    <div
      ref={containerRef}
      className={`${className} overflow-hidden rounded-md ${
        buildMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
      }`}
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
