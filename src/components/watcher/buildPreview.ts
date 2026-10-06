// Build mode's guides in the watcher: outlines on blocks a left click (or drag) would break, and
// see-through copies of the held block where a right click (or drag) would place it.
import * as THREE from 'three'
import { itemIcon } from '../../utils/itemIcons'
import { textureFromUrl } from '../../utils/entity/textures'

const OUTLINE_COLOR = '#f5f5f5'
const BREAK_LINE_COLOR = '#fb7185'
const GHOST_EDGE_COLOR = '#7dd3fc'
const GHOST_OPACITY = 0.55

export type BuildLineMode = 'place' | 'break'

export const createBuildPreview = (scene: THREE.Scene) => {
  const box = new THREE.BoxGeometry(1, 1, 1)
  const outlineGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004))
  const ghostEdges = new THREE.EdgesGeometry(box)
  const outlineMaterial = new THREE.LineBasicMaterial({
    color: OUTLINE_COLOR,
    transparent: true,
    opacity: 0.9,
  })
  const breakMaterial = new THREE.LineBasicMaterial({
    color: BREAK_LINE_COLOR,
    transparent: true,
    opacity: 0.95,
  })
  const ghostEdgeMaterial = new THREE.LineBasicMaterial({
    color: GHOST_EDGE_COLOR,
    transparent: true,
    opacity: 0.9,
  })

  const root = new THREE.Group()
  scene.add(root)

  // Blocks the bot still has to break (red outline over a faint red glow) or place (blue outline), kept
  // up while it works through them.
  const queuedRoot = new THREE.Group()
  scene.add(queuedRoot)
  const glowGeometry = new THREE.BoxGeometry(1.02, 1.02, 1.02)
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: BREAK_LINE_COLOR,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  })
  const queuedPlaceMaterial = new THREE.LineBasicMaterial({
    color: GHOST_EDGE_COLOR,
    transparent: true,
    opacity: 0.5,
  })
  const queuedBreak: THREE.Group[] = []
  const queuedPlace: THREE.LineSegments[] = []
  const queuedBreakItem = (index: number) => {
    while (queuedBreak.length <= index) {
      const group = new THREE.Group()
      const glow = new THREE.Mesh(glowGeometry, glowMaterial)
      glow.renderOrder = 3
      const line = new THREE.LineSegments(outlineGeometry, breakMaterial)
      line.renderOrder = 4
      group.add(glow, line)
      queuedRoot.add(group)
      queuedBreak.push(group)
    }
    return queuedBreak[index]
  }
  const queuedPlaceItem = (index: number) => {
    while (queuedPlace.length <= index) {
      const line = new THREE.LineSegments(outlineGeometry, queuedPlaceMaterial)
      line.renderOrder = 4
      queuedRoot.add(line)
      queuedPlace.push(line)
    }
    return queuedPlace[index]
  }
  const placeAt = (object: THREE.Object3D, corner: THREE.Vector3) => {
    object.position.set(corner.x + 0.5, corner.y + 0.5, corner.z + 0.5)
    object.visible = true
  }
  const outlines: THREE.LineSegments[] = []
  const ghosts: { group: THREE.Group; faces: THREE.Mesh }[] = []

  let materials: THREE.MeshBasicMaterial[] = []
  let item: string | null = null

  const material = (map: THREE.Texture | null, tint: string | null) =>
    new THREE.MeshBasicMaterial({
      map,
      color: tint ?? (map ? '#ffffff' : '#bae6fd'),
      transparent: true,
      opacity: GHOST_OPACITY,
      depthWrite: false,
      alphaTest: map ? 0.05 : 0,
    })

  // Grows the pools to `count` and returns the first `count` of each kind.
  const outline = (index: number) => {
    while (outlines.length <= index) {
      const line = new THREE.LineSegments(outlineGeometry, outlineMaterial)
      line.renderOrder = 4
      root.add(line)
      outlines.push(line)
    }
    return outlines[index]
  }
  const ghost = (index: number) => {
    while (ghosts.length <= index) {
      const faces = new THREE.Mesh(box, materials)
      // A hair smaller than a block so it doesn't flicker against the neighbors it touches.
      faces.scale.setScalar(0.998)
      const group = new THREE.Group()
      group.add(faces, new THREE.LineSegments(ghostEdges, ghostEdgeMaterial))
      group.renderOrder = 5
      root.add(group)
      ghosts.push({ group, faces })
    }
    return ghosts[index]
  }

  // Shows outlines on `outlined` and ghosts on `placed` (block corners in scene coordinates).
  const draw = (outlined: THREE.Vector3[], placed: THREE.Vector3[], color: THREE.LineBasicMaterial) => {
    outlined.forEach((corner, index) => {
      const line = outline(index)
      line.material = color
      line.position.set(corner.x + 0.5, corner.y + 0.5, corner.z + 0.5)
      line.visible = true
    })
    for (let index = outlined.length; index < outlines.length; index++) outlines[index].visible = false
    const shown = item === null ? [] : placed
    shown.forEach((corner, index) => {
      const entry = ghost(index)
      entry.group.position.set(corner.x + 0.5, corner.y + 0.5, corner.z + 0.5)
      entry.group.visible = true
    })
    for (let index = shown.length; index < ghosts.length; index++) ghosts[index].group.visible = false
  }

  // Textures the ghosts like the held block: top on top and bottom, the icon's two sides around.
  // Items without a cube icon (torches, slabs drawn flat, …) get a plain tinted box.
  const setItem = (name: string | null) => {
    if (name === item) return
    item = name
    materials.forEach((entry) => entry.dispose())
    const icon = name ? itemIcon(name) : null
    if (icon?.kind === 'cube') {
      const [top, front, side] = icon.faces.map((face) => material(textureFromUrl(face.src), face.tint))
      materials = [side, side.clone(), top, top.clone(), front, front.clone()]
    } else {
      const plain = material(null, null)
      materials = [plain, plain, plain, plain, plain, plain]
    }
    for (const entry of ghosts) entry.faces.material = materials
    if (name === null) for (const entry of ghosts) entry.group.visible = false
  }

  return {
    setItem,
    // Hovering: `target` is the block under the mouse, `place` the free spot on the face it points at.
    show(target: THREE.Vector3 | null, place: THREE.Vector3 | null) {
      draw(target ? [target] : [], place ? [place] : [], outlineMaterial)
    },
    // Dragging: every block of the line, as ghosts to place or red outlines to break.
    showLine(cells: THREE.Vector3[], mode: BuildLineMode) {
      if (mode === 'place') draw([], cells, outlineMaterial)
      else draw(cells, [], breakMaterial)
    },
    hide() {
      draw([], [], outlineMaterial)
    },
    // The bot's remaining work, as block corners in scene coordinates.
    setQueued(breaking: THREE.Vector3[], placing: THREE.Vector3[]) {
      breaking.forEach((corner, index) => placeAt(queuedBreakItem(index), corner))
      for (let index = breaking.length; index < queuedBreak.length; index++)
        queuedBreak[index].visible = false
      placing.forEach((corner, index) => placeAt(queuedPlaceItem(index), corner))
      for (let index = placing.length; index < queuedPlace.length; index++) queuedPlace[index].visible = false
    },
    // A slow breathe, so it reads as a preview rather than real blocks.
    update(now: number) {
      const opacity = GHOST_OPACITY + Math.sin(now * 3) * 0.12
      for (const entry of materials) entry.opacity = opacity
      breakMaterial.opacity = 0.75 + Math.sin(now * 6) * 0.2
      glowMaterial.opacity = 0.14 + Math.sin(now * 6) * 0.06
    },
    // Scene coordinates shift when the view re-anchors far from the origin; the next pointer move redraws.
    shift() {
      draw([], [], outlineMaterial)
    },
    dispose() {
      materials.forEach((entry) => entry.dispose())
      ;[outlineMaterial, breakMaterial, ghostEdgeMaterial, queuedPlaceMaterial, glowMaterial].forEach(
        (entry) => entry.dispose()
      )
      ;[box, outlineGeometry, ghostEdges, glowGeometry].forEach((entry) => entry.dispose())
    },
  }
}
