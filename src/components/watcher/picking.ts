// What's under the mouse in the watcher: a block (with the side that was hit) or an entity.
import * as THREE from 'three'
import type { WorldView } from '../../types'

type Blocks = WorldView['blocks']

export type Pickable = { mesh: THREE.Mesh; quads: number[]; blocks: Blocks }

export type Pick =
  | { kind: 'block'; name: string; position: THREE.Vector3; normal: THREE.Vector3 }
  | { kind: 'entity'; name: string; position: THREE.Vector3; id: number | null }

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()

// `entities` are scene objects tagged with userData.name; `anchor` turns scene positions into world ones.
export const pickAt = (
  event: { clientX: number; clientY: number },
  element: HTMLElement,
  camera: THREE.Camera,
  entities: THREE.Object3D[],
  pickable: Pickable[],
  anchor: THREE.Vector3
): Pick | null => {
  const rect = element.getBoundingClientRect()
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  )
  raycaster.setFromCamera(pointer, camera)
  const hit = raycaster.intersectObjects([...entities, ...pickable.map((entry) => entry.mesh)], true)[0]
  if (!hit) return null

  const picked = pickable.find((entry) => entry.mesh === hit.object)
  if (picked) {
    if (hit.faceIndex == null) return null
    // Two triangles per quad.
    const index = picked.quads[Math.floor(hit.faceIndex / 2)]
    const { origin, palette, positions, blocks } = picked.blocks
    return {
      kind: 'block',
      name: palette[blocks[index]],
      position: new THREE.Vector3(
        origin.x + positions[index * 3],
        origin.y + positions[index * 3 + 1],
        origin.z + positions[index * 3 + 2]
      ),
      normal: hit.face ? hit.face.normal.clone().round() : new THREE.Vector3(0, 1, 0),
    }
  }

  let object: THREE.Object3D | null = hit.object
  while (object && !object.userData.name) {
    object = object.parent
  }
  if (!object) return null
  return {
    kind: 'entity',
    name: String(object.userData.name),
    position: object.position.clone().add(anchor),
    id: typeof object.userData.entityId === 'number' ? object.userData.entityId : null,
  }
}

// Where the bot should stand for a click: on top of a block clicked from above, next to it when a side
// was clicked, or where an entity is.
export const walkTarget = (pick: Pick) =>
  pick.kind === 'entity'
    ? pick.position.clone().floor()
    : pick.position.clone().add(pick.normal.y > 0.5 ? new THREE.Vector3(0, 1, 0) : pick.normal)
