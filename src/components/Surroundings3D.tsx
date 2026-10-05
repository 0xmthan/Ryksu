import interactiveBlocks from '../shared/interactiveBlocks.json'
import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { BuildAction, BuildCells, InventoryItem, Motion, MotionEntity, WorldView } from '../types'
import { prettyName } from '../utils/blockColors'
import { loadBlockAtlas, type BlockAtlas } from '../utils/blockAtlas'
import { modeFor, type ViewMode } from '../utils/viewMode'
import { createTracked, stepTracked, syncTracked, type Tracked } from './watcher/entityObjects'
import { createSelfMotion } from './watcher/selfMotion'
import { groundTarget, isDoorBlock, isLiquid, pickAt, REPLACEABLE_BLOCKS, walkTarget, type Pick } from './watcher/picking'
import { disposeObject, makeLabel } from './watcher/sceneUtils'
import { createSky } from './watcher/sky'
import { applyBlockLight } from './watcher/blockLight'
import { createWalkMarker } from './watcher/walkMarker'
import useManualMovement, { type MovementLook } from '../hooks/useManualMovement'
import { createCameraRig } from './watcher/cameraRig'
import { addSilhouette } from './watcher/silhouette'
import { createFirstPerson, HAND_FOV } from './watcher/firstPerson'
import { createFirstPersonHand } from './watcher/firstPersonHand'
import { createBreakEffects } from './watcher/breakEffects'
import { createChunkMeshes } from './watcher/chunkMeshes'
import { createPlayerHover } from './watcher/playerHover'
import HandCard from './watcher/HandCard'
import ArmorSlot from './watcher/ArmorSlot'
import { createBuildPreview, type BuildLineMode } from './watcher/buildPreview'
import {
  applySeeThrough,
  getSeeThroughShape,
  isSeeThrough,
  SEE_THROUGH_SHAPES,
  setSeeThroughShape,
  updateSeeThrough,
} from './watcher/seeThrough'
import { loadGraphicsSettings, onGraphicsSettingsChange } from '../utils/graphicsSettings'
import { reportFps } from '../utils/frameRate'
import { applyEdgeFog, fogObject, updateEdgeFog } from './watcher/edgeFog'
import { updateTorchRayBlocks, updateTorchRayCasters, updateTorchRayLights } from './watcher/torchRays'
import { applyWater, setWaterQuality, updateWater } from './watcher/water'

type Blocks = WorldView['blocks']

// How quickly shown positions catch up with the latest update (per second); higher is snappier.
const FOLLOW_RATE = 12
// Two clicks on the same entity within this long make a double click (attack).
const DOUBLE_CLICK_MS = 280
// Holding the left button this long turns a click into a walk that keeps following the pointer, updated
// this often, and only once the spot under it moved this many blocks (so the path isn't replanned for nothing).
const HOLD_WALK_DELAY_MS = 220
const HOLD_WALK_INTERVAL_MS = 300
const HOLD_WALK_STEP = 1.5
// First person sends where it looks at most this often (seconds): every frame.
const LOOK_SEND_S = 1 / 60
// Holding left in first person starts on the next block this long after one breaks (the game's 5 ticks).
const DIG_REPEAT_DELAY_S = 0.25
// The bot follows its per-tick position this snugly (per second); without ticks for this long (the bot
// isn't simulating, say it's riding), it falls back to the slower motion stream.
const SELF_FOLLOW_RATE = 40
// How close the orbit camera gets (blocks from the point it circles, at the bot's shoulders): about at
// its head. Zooming in from there goes into first person.
const FIRST_PERSON_DISTANCE = 0.9
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
  // First person: the mouse wheel moves the hotbar selection this many slots (+1 right, -1 left).
  onHotbarScroll?: (step: number) => void
  // First person: the view was clicked while chat was open; close it (the click grabs the mouse back).
  onCloseChat?: () => void
  // Sizes the view; the canvas fills it.
  className?: string
}

type SceneState = {
  scene: THREE.Scene
  anchor: THREE.Vector3 | null
  // The blocks, as chunk meshes (watcher/chunkMeshes.ts).
  chunks: ReturnType<typeof createChunkMeshes> | null
  chestOutlines: THREE.Object3D[]
  materials: {
    opaque: THREE.Material
    translucent: THREE.Material
    water: THREE.Material
    ghost: THREE.Material
    cap: THREE.Material
  }
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
  onHotbarScroll,
  onCloseChat,
  className = 'relative mt-3 h-[360px] w-full',
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const mainHandRef = useRef<HTMLDivElement>(null)
  const offHandRef = useRef<HTMLDivElement>(null)
  const armorRef = useRef<HTMLDivElement>(null)
  // Clicking the bot shows what it holds and wears.
  const [gearOpen, setGearOpen] = useState(false)
  // First person (zoomed all the way in) and whether it has the mouse, for the crosshair and hint.
  const [firstPersonView, setFirstPersonView] = useState({ active: false, locked: false })
  const gearOpenRef = useRef(gearOpen)
  gearOpenRef.current = gearOpen
  const stateRef = useRef<SceneState | null>(null)
  // Which way WASD goes: around the camera, or in first person, the way the bot looks (strafing).
  const movementLook = useRef<MovementLook>({ yaw: 0 })
  const movementEnabledRef = useRef(movementEnabled)
  movementEnabledRef.current = movementEnabled
  const cameraRigRef = useRef<ReturnType<typeof createCameraRig> | null>(null)
  // The camera is always on the bot, so walking with the keys needs nothing extra.
  useManualMovement(movementEnabled, () => movementLook.current, () => {})
  const onHotbarScrollRef = useRef(onHotbarScroll)
  onHotbarScrollRef.current = onHotbarScroll
  const onCloseChatRef = useRef(onCloseChat)
  onCloseChatRef.current = onCloseChat
  const firstPersonRef = useRef<ReturnType<typeof createFirstPerson> | null>(null)
  // A window over the view (chat, inventory, a menu) gets the mouse back until it closes.
  useEffect(() => {
    if (movementEnabled) firstPersonRef.current?.resume()
    else firstPersonRef.current?.pause()
  }, [movementEnabled])
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

    // Stencil for the outlines of the bot and players seen through blocks (watcher/silhouette.ts).
    const graphics = loadGraphicsSettings()
    const renderer = new THREE.WebGLRenderer({ antialias: graphics.antialiasing, stencil: true })
    renderer.setPixelRatio(window.devicePixelRatio * graphics.resolutionScale)
    const height = () => Math.max(1, container.clientHeight)
    renderer.setSize(container.clientWidth, height())
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const sky = createSky(scene, renderer, graphics.shadows)
    // Game time of day (ticks), from the latest motion update.
    let timeOfDay = 6000

    // Minecraft and three.js are both Y-up and right-handed, so world axes map straight across.
    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / height(), 0.1, 800)
    camera.position.set(16, 22, 24)
    const playerHover = createPlayerHover(renderer, scene, camera)
    let hoveredPlayer: number | null = null
    let botWalking = false
    const controls = new OrbitControls(camera, renderer.domElement)
    // Left is for walking (click, or hold to keep walking toward the pointer); a right or middle drag turns
    // the camera around the bot and the wheel zooms. The camera never pans off the bot.
    controls.mouseButtons.LEFT = null
    controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE
    controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE
    controls.enablePan = false
    controls.target.set(0, 1, 0)
    controls.enableDamping = true
    controls.dampingFactor = 0.09
    controls.rotateSpeed = 0.65
    controls.zoomSpeed = 0.8
    // Zooms right up to the bot's head; one more step in from there is first person.
    controls.minDistance = FIRST_PERSON_DISTANCE
    controls.maxDistance = 160
    controls.minPolarAngle = 0.15
    controls.maxPolarAngle = Math.PI / 2 - 0.08
    controls.update()
    const cameraRig = createCameraRig(camera, controls)
    cameraRigRef.current = cameraRig
    const firstPerson = createFirstPerson(camera, renderer.domElement, setFirstPersonView)
    const hand = createFirstPersonHand(HAND_FOV)
    firstPersonRef.current = firstPerson
    const enterFirstPerson = () => {
      controls.enabled = false
      firstPerson.enter(movementLook.current.yaw)
    }
    const leaveFirstPerson = () => {
      firstPerson.leave(controls)
      controls.enabled = true
      controls.update()
    }
    // Zooming in past the closest distance goes into first person. In it, the wheel changes the hotbar slot
    // like the game while the mouse is grabbed, and scrolling out leaves while it isn't (F5 and F always do).
    // In the capture phase, so the orbit controls don't zoom as well.
    const handleWheel = (event: WheelEvent) => {
      if (firstPerson.isActive()) {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (firstPerson.isZooming()) {
          firstPerson.zoomScroll(event.deltaY)
        } else if (firstPerson.isLocked()) {
          if (event.deltaY !== 0) onHotbarScrollRef.current?.(event.deltaY > 0 ? 1 : -1)
        } else if (firstPerson.scrollOut(event.deltaY)) {
          leaveFirstPerson()
        }
        return
      }
      if (event.deltaY < 0 && camera.position.distanceTo(controls.target) <= FIRST_PERSON_DISTANCE + 0.15) {
        event.preventDefault()
        event.stopImmediatePropagation()
        enterFirstPerson()
      }
    }

    const state: SceneState = {
      scene,
      anchor: null,
      chunks: null,
      chestOutlines: [],
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
        // Water, like the translucent blocks but with its own shading (watcher/water.ts).
        water: new THREE.MeshLambertMaterial({
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
        // The tops of blocks under cut-away blocks, darkened like a cut-away floor (see watcher/seeThrough.ts).
        cap: new THREE.MeshLambertMaterial({ vertexColors: true, alphaTest: 0.5, color: CAP_SHADE }),
      },
      mode: 'full',
    }
    stateRef.current = state
    applySeeThrough(state.materials.opaque, 'solid')
    applySeeThrough(state.materials.cap, 'cap')
    applyBlockLight(state.materials.opaque)
    applyBlockLight(state.materials.translucent)
    applyBlockLight(state.materials.cap)
    applyBlockLight(state.materials.water)
    applyWater(state.materials.water)
    setWaterQuality(graphics.water)
    for (const material of Object.values(state.materials)) applyEdgeFog(material)
    let fogEnabled = graphics.fog
    let torchRays = graphics.torchRays
    state.chunks = createChunkMeshes(scene, state.materials, { ambientOcclusion: graphics.ambientOcclusion })

    // The bot is drawn like any other player; the camera follows it.
    let bot: Tracked | null = null
    const walkMarker = createWalkMarker(scene)
    const buildPreview = createBuildPreview(scene)
    const self = createSelfMotion()
    let selfSprinting = false
    const unsubscribeSelf = window.electronAPI.bot.onSelfMotion((motion) => {
      self.receive(motion, clock.elapsedTime)
      selfSprinting = motion.sprinting === true
    })
    const predicted = new THREE.Vector3()
    const waterLight = new THREE.Vector3()
    const waterLightColor = new THREE.Color()
    const breakEffects = createBreakEffects(scene)
    const unsubscribeBreaking = window.electronAPI.bot.onBreaking((breaking) =>
      breakEffects.update(breaking, state.anchor)
    )
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
      fogObject(entry.object)
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
          breakEffects.shift(shift)
          buildPreview.shift()
          for (const entry of tracked) entry.target.add(shift)
        }
        state.anchorVersion++
        setAnchorVersion(state.anchorVersion)
      }

      const firstSight = !bot
      const botEntity: MotionEntity = {
        ...motion.bot,
        id: -1,
        kind: 'player',
        type: 'player',
        item: null,
        name: motion.bot.name ?? 'Bot',
        skin: motion.bot.skin ?? undefined,
        cape: motion.bot.cape ?? undefined,
        slim: motion.bot.slim,
      }
      bot = track(botEntity, bot, true)
      hand.setEntity(botEntity)
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
    let frameCount = 0
    let lastLookSent = 0
    let sentYaw = Infinity
    let sentPitch = Infinity
    // With a frame-rate limit, frames that come too soon after the last drawn one are skipped.
    let frameInterval = graphics.maxFps > 0 ? 1000 / graphics.maxFps : 0
    let lastFrameAt = -Infinity
    let fpsFrames = 0
    let fpsSince = performance.now()
    const render = (time = performance.now()) => {
      frame = requestAnimationFrame(render)
      // A little slack, so a 60 limit on a 60 Hz display doesn't drop frames to timer jitter.
      if (frameInterval && time - lastFrameAt < frameInterval - 2) return
      lastFrameAt = time
      // Frames drawn, counted over half a second.
      fpsFrames++
      if (time - fpsSince >= 500) {
        reportFps(Math.round((fpsFrames * 1000) / (time - fpsSince)))
        fpsFrames = 0
        fpsSince = time
      }
      const delta = clock.getDelta()
      const now = clock.elapsedTime
      const blend = 1 - Math.exp(-delta * FOLLOW_RATE)

      sky.update(timeOfDay, state.mode, bot ? bot.object.position : controls.target, delta)
      updateWater(now, scene.background as THREE.Color, sky.lightDirection(waterLight), sky.lightColor(waterLightColor))
      updateEdgeFog(
        fogEnabled,
        bot ? bot.object.position : controls.target,
        scene.background as THREE.Color,
        blocksRef.current?.radius ?? 52
      )

      if (bot) {
        if (state.anchor && self.fresh(now)) {
          self.sample(now, predicted).sub(state.anchor)
          bot.target.copy(predicted)
          stepTracked(bot, 1 - Math.exp(-delta * SELF_FOLLOW_RATE), delta, now)
        } else {
          stepTracked(bot, blend, delta, now)
        }
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
      if (frameCount % 10 === 0) updateTorchRayLights(torchRays, bot ? bot.object.position : controls.target)
      // Every frame, so shadows follow walking legs and swinging arms.
      updateTorchRayCasters(
        torchRays,
        [...(bot ? [bot.object] : []), ...[...entities.values()].map((entry) => entry.object)],
        bot ? bot.object.position : controls.target
      )
      // Outlines for when trees or walls are in front of them; new meshes (a held item) get theirs too.
      if (frameCount++ % 15 === 0) {
        if (bot) fogObject(bot.object)
        for (const entry of entities.values()) fogObject(entry.object)
        if (bot) addSilhouette(bot.object, '#7dd3fc', 0.6)
        for (const [id, entry] of entities) {
          if (entityInfo.get(id)?.kind === 'player') addSilhouette(entry.object, '#f5f5f5', 0.45)
        }
      }
      walkMarker.update(now, bot ? bot.object.position : null, botWalking)
      buildPreview.update(now)
      breakEffects.tick(state.anchor, delta)
      state.chunks?.tick()

      const inFirstPerson = firstPerson.isActive() && bot !== null
      if (bot) bot.object.visible = !inFirstPerson
      if (inFirstPerson) {
        firstPerson.update(bot!.object.position, bot!.crouching, delta, self.fresh(now) && selfSprinting)
        movementLook.current = { yaw: firstPerson.yaw(), pitch: firstPerson.pitch(), relative: true }
        // Nothing to cut away from inside the bot's head.
        updateSeeThrough(camera, null)
        if (firstPerson.isLocked()) {
          // The bot turns its head with the view, so others see where it looks and hits land there.
          const { yaw, pitch } = movementLook.current
          if (now - lastLookSent > LOOK_SEND_S && (Math.abs(yaw - sentYaw) > 0.005 || Math.abs(pitch! - sentPitch) > 0.005)) {
            window.electronAPI.bot.firstPerson.look(yaw, pitch!)
            sentYaw = yaw
            sentPitch = pitch!
            lastLookSent = now
          }
          // The bottom bar names what the crosshair is on, like hovering does in third person.
          if (frameCount % 6 === 0) describeHover(pickCrosshair())
        }
        if (frameCount % 3 === 0) continueDigging()
      } else {
        controls.update()
        updateSeeThrough(camera, bot ? bot.object.position : null)
        const dx = controls.target.x - camera.position.x
        const dz = controls.target.z - camera.position.z
        if (dx * dx + dz * dz > 0.0001) movementLook.current = { yaw: Math.atan2(-dx, -dz) }
      }
      const selected = gearOpenRef.current ? bot : hoveredPlayer !== null ? entities.get(hoveredPlayer) : null
      placeHands()
      placeArmor()
      for (const entry of [...entities.values(), ...(bot ? [bot] : [])]) {
        entry.nametag?.setHovered(entry === selected)
      }
      playerHover.render(selected?.model?.root ?? null, delta)
      if (inFirstPerson) hand.render(renderer, camera.aspect, now, firstPerson.zoomAmount())
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

    // Settings changed in game apply now, except antialiasing, which the canvas only takes when it's made.
    const unsubscribeGraphics = onGraphicsSettingsChange((next) => {
      const ratio = window.devicePixelRatio * next.resolutionScale
      if (renderer.getPixelRatio() !== ratio) {
        renderer.setPixelRatio(ratio)
        renderer.setSize(container.clientWidth, height())
        playerHover.setPixelRatio(ratio)
      }
      sky.setShadows(next.shadows)
      fogEnabled = next.fog
      setWaterQuality(next.water)
      torchRays = next.torchRays
      updateTorchRayLights(torchRays, bot ? bot.object.position : controls.target)
      state.chunks?.setOptions({ ambientOcclusion: next.ambientOcclusion })
      frameInterval = next.maxFps > 0 ? 1000 / next.maxFps : 0
    })

    // The name and coordinates of what's under the mouse (or crosshair), for the bottom bar.
    let lastHover: string | null = null
    const describeHover = (picked: Pick | null) => {
      let text: string | null = null
      if (picked) {
        const { x, y, z } = picked.position
        const coordinates = `${Math.floor(x)} / ${Math.floor(y)} / ${Math.floor(z)}`
        const name =
          picked.kind === 'entity' && picked.id !== null && entityInfo.get(picked.id)?.kind === 'player'
            ? picked.name
            : prettyName(picked.name)
        const doorState =
          picked.kind === 'block' && isDoorBlock(picked.name) ? ` · ${picked.open ? 'Open' : 'Closed'}` : ''
        text = `${name} · ${coordinates}${doorState}`
      }
      if (text === lastHover) return
      lastHover = text
      onHoverRef.current(text)
    }
    const pickCrosshair = () => {
      const rect = renderer.domElement.getBoundingClientRect()
      return pick({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 })
    }
    const pick = (event: { clientX: number; clientY: number }, skipBlock?: (name: string) => boolean) =>
      state.anchor
        ? pickAt(
            event,
            renderer.domElement,
            camera,
            // In first person the camera is inside the bot's (hidden) head, which would be hit first.
            [...(bot && !firstPerson.isActive() ? [bot.object] : []), ...[...entities.values()].map((entry) => entry.object)],
            state.chunks?.pickable() ?? [],
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
      if (firstPerson.isActive()) return
      if (holdWalk) holdWalk.event = event
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
      describeHover(picked)
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
      if (firstPerson.isActive()) return
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
    // Holding the left button on the ground keeps walking toward the pointer; the camera follows the bot,
    // so a long walk is just holding the mouse where you want to go.
    let holdWalk: { event: PointerEvent; timer: number; interval: number | null; last: THREE.Vector3 | null } | null = null
    const stepHoldWalk = () => {
      if (!holdWalk || !state.anchor) return
      const picked = pick(holdWalk.event)
      if (picked?.kind !== 'block') return
      const target = groundTarget(picked, blocksRef.current)
      if (holdWalk.last && holdWalk.last.distanceTo(target) < HOLD_WALK_STEP) return
      holdWalk.last = target
      walkMarker.show(target.clone().sub(state.anchor), clock.elapsedTime)
      onWalkToRef.current({ x: target.x, y: target.y, z: target.z })
    }
    const stopHoldWalk = () => {
      if (!holdWalk) return false
      const walking = holdWalk.interval !== null
      clearTimeout(holdWalk.timer)
      if (holdWalk.interval !== null) clearInterval(holdWalk.interval)
      holdWalk = null
      return walking
    }
    // First person, like the game: the first click grabs the mouse. Then a left click hits what the crosshair
    // is on (or swings at the air), holding it on a block digs it; a right click uses the block (chests,
    // doors, crafting tables, …) or places the held block against it.
    // Holding left digs block after block like the game: when one breaks, the next one under the crosshair
    // starts after a short pause, and moving onto another block switches to it right away.
    let firstPersonDigging = false
    let digTarget: THREE.Vector3 | null = null
    let digRun = 0
    let nextDigAt = 0
    const startDig = (position: THREE.Vector3) => {
      const run = ++digRun
      digTarget = position.clone()
      window.electronAPI.bot.firstPerson
        .dig({ x: position.x, y: position.y, z: position.z })
        .catch(() => ({ ok: false }))
        .then(() => {
          if (run !== digRun) return
          digTarget = null
          nextDigAt = clock.elapsedTime + DIG_REPEAT_DELAY_S
        })
    }
    const stopDigging = () => {
      if (!firstPersonDigging) return
      firstPersonDigging = false
      digRun++
      digTarget = null
      hand.setDigging(false)
      window.electronAPI.bot.firstPerson.stopDig()
    }
    // Each few frames while the button is held.
    const continueDigging = () => {
      if (!firstPersonDigging) return
      // The mouse was let go (Esc, a window opened) while held: the button-up never comes.
      if (!firstPerson.isLocked()) {
        stopDigging()
        return
      }
      const picked = pickCrosshair()
      if (picked?.kind !== 'block') return
      if (digTarget?.equals(picked.position)) return
      if (!digTarget && clock.elapsedTime < nextDigAt) return
      startDig(picked.position)
    }
    const handleFirstPersonClick = (event: PointerEvent) => {
      // Clicking back into the view while chat is open closes it, like the game.
      if (onCloseChatRef.current) {
        onCloseChatRef.current()
        firstPerson.lock()
        return
      }
      if (!firstPerson.isLocked()) {
        firstPerson.lock()
        return
      }
      const picked = pickCrosshair()
      const actions = window.electronAPI.bot.firstPerson
      if (event.button === 0) {
        hand.swing(clock.elapsedTime)
        if (picked?.kind === 'block') {
          firstPersonDigging = true
          hand.setDigging(true)
          startDig(picked.position)
        } else {
          actions.hit(picked?.kind === 'entity' ? picked.id : null).catch(() => {})
        }
        return
      }
      if (event.button !== 2 || picked?.kind !== 'block') return
      const { x, y, z } = picked.position
      if (interactiveBlocks.includes(picked.name) || isDoorBlock(picked.name)) {
        onBlockInteractRef.current({ x, y, z })
      } else if (heldBlockRef.current) {
        hand.swing(clock.elapsedTime)
        const face = { x: picked.normal.x, y: picked.normal.y, z: picked.normal.z }
        actions
          .place({ x, y, z }, face, REPLACEABLE_BLOCKS.has(picked.name))
          .then((result) => {
            if (!result.ok && result.message) onHoverRef.current(result.message)
          })
          .catch(() => {})
      }
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (firstPerson.isActive()) {
        pressed = null
        handleFirstPersonClick(event)
        return
      }
      pressed =
        event.button === 0 || event.button === 2
          ? { x: event.clientX, y: event.clientY, button: event.button }
          : null
      stopHoldWalk()
      if (event.button !== 0 || buildModeRef.current || onBlockPickRef.current || !movementEnabledRef.current) return
      if (pick(event)?.kind !== 'block') return
      holdWalk = {
        event,
        interval: null,
        last: null,
        timer: window.setTimeout(() => {
          if (!holdWalk) return
          holdWalk.interval = window.setInterval(stepHoldWalk, HOLD_WALK_INTERVAL_MS)
          stepHoldWalk()
        }, HOLD_WALK_DELAY_MS),
      }
    }
    const handlePointerUp = (event: PointerEvent) => {
      if (event.button === 0) stopDigging()
      const start = pressed
      pressed = null
      // A held walk already went where the pointer is; the bot finishes the last stretch on its own.
      if (event.button === 0 && holdWalk) {
        if (holdWalk.interval !== null) holdWalk.event = event
        if (holdWalk.interval !== null) stepHoldWalk()
        if (stopHoldWalk()) return
      }
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
        const target = walkTarget(picked)
        walkMarker.show(target.clone().sub(state.anchor), clock.elapsedTime)
        onWalkToRef.current({ x: target.x, y: target.y, z: target.z })
      }
      // Clicking a block walks to it (doors open with a right click); clicking a wall, to the ground below.
      if (picked.kind === 'block') {
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
    const handlePointerLeave = () => { stopHoldWalk(); hoveredPlayer = null; buildPreview.hide(); onHoverRef.current(null) }
    const handleContextMenu = (event: MouseEvent) => event.preventDefault()
    const handleCameraKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setGearOpen(false)
      if (event.key === 'Escape' && buildDrag) {
        event.stopImmediatePropagation()
        endBuildDrag()
        return
      }
      // F5 switches between first and third person, like the game.
      if (event.code === 'F5' && movementEnabledRef.current && !event.repeat) {
        event.preventDefault()
        if (firstPerson.isActive()) leaveFirstPerson()
        else enterFirstPerson()
        return
      }
      // H cycles how blocks in front of the bot turn see-through.
      if (
        event.code === 'KeyH' &&
        !event.repeat &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !document.querySelector('[role="dialog"]') &&
        !document.activeElement?.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        const next =
          SEE_THROUGH_SHAPES[(SEE_THROUGH_SHAPES.indexOf(getSeeThroughShape()) + 1) % SEE_THROUGH_SHAPES.length]
        setSeeThroughShape(next)
        onHoverRef.current(next === 'cutaway' ? 'Cutaway on: leaves and roofs over the bot are hidden' : 'Cutaway off')
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
      if (firstPerson.isActive()) leaveFirstPerson()
      else cameraRig.recenter()
    }
    window.addEventListener('keydown', handleCameraKey)
    renderer.domElement.addEventListener('wheel', handleWheel, { capture: true, passive: false })
    renderer.domElement.addEventListener('contextmenu', handleContextMenu)
    renderer.domElement.addEventListener('pointermove', handlePointerMove)
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave)
    renderer.domElement.addEventListener('pointerdown', handlePointerDown)
    container.addEventListener('pointerdown', handleBuildPointerDown, true)
    renderer.domElement.addEventListener('pointerup', handlePointerUp)

    return () => {
      cancelAnimationFrame(frame)
      stopHoldWalk()
      renderer.domElement.removeEventListener('wheel', handleWheel, { capture: true })
      firstPerson.dispose()
      hand.dispose()
      firstPersonRef.current = null
      if (pendingClick) clearTimeout(pendingClick.timer)
      unsubscribeMotion()
      unsubscribeBreaking()
      unsubscribeSelf()
      breakEffects.dispose()
      state.chunks?.dispose()
      state.chunks = null
      resizeObserver.disconnect()
      unsubscribeGraphics()
      reportFps(null)
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
      state.materials.water.dispose()
      state.materials.ghost.dispose()
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

  // A new block payload: only the chunks that changed are rebuilt (watcher/chunkMeshes.ts).
  useEffect(() => {
    const state = stateRef.current
    if (!state?.anchor || !state.chunks || !blocks || !atlas) {
      return
    }
    for (const material of Object.values(state.materials) as THREE.MeshBasicMaterial[]) {
      if (material.map !== atlas.texture) {
        material.map = atlas.texture
        material.needsUpdate = true
      }
    }
    const mode = modeFor(blocks.environment)
    state.mode = mode
    const offset = new THREE.Vector3(
      blocks.origin.x - state.anchor.x,
      blocks.origin.y - state.anchor.y,
      blocks.origin.z - state.anchor.z
    )
    state.chunks.update(blocks, atlas, mode, offset)
    updateTorchRayBlocks(blocks, offset)
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
        buildMode || firstPersonView.active ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
      }`}
    >
      {firstPersonView.active ? (
        <>
          {/* The game's crosshair: a thin plus that inverts what's behind it. */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 mix-blend-difference">
            <span className="absolute left-0 top-1/2 h-[2px] w-full -translate-y-1/2 bg-white" />
            <span className="absolute left-1/2 top-0 h-full w-[2px] -translate-x-1/2 bg-white" />
          </div>
          {firstPersonView.locked ? null : (
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 mt-8 -translate-x-1/2 rounded-md bg-neutral-950/80 px-3 py-1.5 text-xs text-neutral-300">
              Click to look around · Scroll out or F5 to leave
            </div>
          )}
        </>
      ) : null}
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
