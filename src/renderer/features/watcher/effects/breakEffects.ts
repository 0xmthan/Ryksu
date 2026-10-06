// The game's block breaking look: crack textures (destroy stages 0-9) over a block while it's dug, and a
// burst of block-colored bits when the bot breaks one. Positions come in world coordinates.
import * as THREE from 'three'
import stage0 from 'minecraft-assets/minecraft-assets/data/26.1/blocks/destroy_stage_0.png'
import stage1 from 'minecraft-assets/minecraft-assets/data/26.1/blocks/destroy_stage_1.png'
import stage2 from 'minecraft-assets/minecraft-assets/data/26.1/blocks/destroy_stage_2.png'
import stage3 from 'minecraft-assets/minecraft-assets/data/26.1/blocks/destroy_stage_3.png'
import stage4 from 'minecraft-assets/minecraft-assets/data/26.1/blocks/destroy_stage_4.png'
import stage5 from 'minecraft-assets/minecraft-assets/data/26.1/blocks/destroy_stage_5.png'
import stage6 from 'minecraft-assets/minecraft-assets/data/26.1/blocks/destroy_stage_6.png'
import stage7 from 'minecraft-assets/minecraft-assets/data/26.1/blocks/destroy_stage_7.png'
import stage8 from 'minecraft-assets/minecraft-assets/data/26.1/blocks/destroy_stage_8.png'
import stage9 from 'minecraft-assets/minecraft-assets/data/26.1/blocks/destroy_stage_9.png'
import type { BreakingState } from '../../../../shared/types'
import { blockColor } from '../../../lib/blockColors'

const STAGE_URLS = [stage0, stage1, stage2, stage3, stage4, stage5, stage6, stage7, stage8, stage9]
// Bits per broken block, how long they last (seconds), and gravity (blocks/s²).
const BITS = 18
const BIT_LIFE = 0.9
const GRAVITY = 18

type Bit = { mesh: THREE.Mesh; velocity: THREE.Vector3; age: number; life: number }

export const createBreakEffects = (scene: THREE.Scene) => {
  const loader = new THREE.TextureLoader()
  // The cracks darken what's under them like the game's multiply blend.
  const stageMaterials = STAGE_URLS.map((url) => {
    const texture = loader.load(url)
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.NearestFilter
    texture.colorSpace = THREE.SRGBColorSpace
    return new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      // The blend ignores alpha, so the clear parts of the texture are dropped here.
      alphaTest: 0.1,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      blending: THREE.CustomBlending,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.SrcColorFactor,
      blendEquation: THREE.AddEquation,
    })
  })
  const cube = new THREE.BoxGeometry(1.002, 1.002, 1.002)
  const bitGeometry = new THREE.BoxGeometry(0.11, 0.11, 0.11)
  const group = new THREE.Group()
  scene.add(group)
  const cracks: { world: THREE.Vector3; mesh: THREE.Mesh }[] = []
  const bits: Bit[] = []

  const set = ({ cracks: next }: BreakingState) => {
    while (cracks.length > next.length) cracks.pop()!.mesh.removeFromParent()
    next.forEach((crack, index) => {
      let entry = cracks[index]
      if (!entry) {
        const mesh = new THREE.Mesh(cube, stageMaterials[0])
        mesh.raycast = () => {}
        mesh.renderOrder = 5
        group.add(mesh)
        entry = { world: new THREE.Vector3(), mesh }
        cracks.push(entry)
      }
      entry.world.set(crack.x + 0.5, crack.y + 0.5, crack.z + 0.5)
      entry.mesh.material = stageMaterials[Math.max(0, Math.min(9, crack.stage))]
    })
  }

  const burst = (broken: NonNullable<BreakingState['broken']>, anchor: THREE.Vector3) => {
    const base = new THREE.Color(blockColor(broken.name))
    for (let i = 0; i < BITS; i++) {
      const color = base.clone().multiplyScalar(0.75 + Math.random() * 0.4)
      const mesh = new THREE.Mesh(bitGeometry, new THREE.MeshLambertMaterial({ color, transparent: true }))
      mesh.raycast = () => {}
      mesh.position.set(
        broken.x - anchor.x + 0.2 + Math.random() * 0.6,
        broken.y - anchor.y + 0.2 + Math.random() * 0.6,
        broken.z - anchor.z + 0.2 + Math.random() * 0.6
      )
      mesh.scale.setScalar(0.6 + Math.random() * 0.8)
      group.add(mesh)
      bits.push({
        mesh,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 3,
          2 + Math.random() * 3,
          (Math.random() - 0.5) * 3
        ),
        age: 0,
        life: BIT_LIFE * (0.7 + Math.random() * 0.6),
      })
    }
  }

  return {
    update: (state: BreakingState, anchor: THREE.Vector3 | null) => {
      set(state)
      if (state.broken && anchor) burst(state.broken, anchor)
    },
    // Each frame: keeps the cracks on their blocks (the anchor can move) and moves the bits.
    tick: (anchor: THREE.Vector3 | null, delta: number) => {
      for (const crack of cracks) {
        if (anchor) crack.mesh.position.copy(crack.world).sub(anchor)
        crack.mesh.visible = Boolean(anchor)
      }
      for (let i = bits.length - 1; i >= 0; i--) {
        const bit = bits[i]
        bit.age += delta
        if (bit.age >= bit.life) {
          bit.mesh.removeFromParent()
          ;(bit.mesh.material as THREE.Material).dispose()
          bits.splice(i, 1)
          continue
        }
        bit.velocity.y -= GRAVITY * delta
        bit.mesh.position.addScaledVector(bit.velocity, delta)
        ;(bit.mesh.material as THREE.MeshLambertMaterial).opacity = 1 - (bit.age / bit.life) ** 2
      }
    },
    // The view re-anchored: bits are in scene coordinates, so they move with it.
    shift: (delta: THREE.Vector3) => {
      for (const bit of bits) bit.mesh.position.add(delta)
    },
    dispose: () => {
      group.removeFromParent()
      for (const bit of bits) (bit.mesh.material as THREE.Material).dispose()
      bits.length = 0
      for (const material of stageMaterials) {
        material.map?.dispose()
        material.dispose()
      }
      cube.dispose()
      bitGeometry.dispose()
    },
  }
}
