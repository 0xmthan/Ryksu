// Shows the bot and players through whatever stands in front of them (tree trunks, walls, hills) as a flat
// colored outline, instead of turning the blocks see-through. Each mesh of the model gets a twin that only
// draws where it's behind something (depth test reversed). The model itself marks the stencil buffer where
// it shows, so the twin never draws over the model's own visible parts (an arm behind the body, say).
// The renderer needs `stencil: true`.
import * as THREE from 'three'

const MARK = 1
const twins = new WeakMap<THREE.Material, Map<string, THREE.MeshBasicMaterial>>()

// Flat color, but keeping the texture's cut-out shape (hat layers, transparent skin pixels).
const twinMaterial = (source: THREE.Material, color: string, opacity: number) => {
  let byColor = twins.get(source)
  if (!byColor) twins.set(source, (byColor = new Map()))
  const key = `${color}:${opacity}`
  let material = byColor.get(key)
  if (material) return material
  const map = (source as THREE.MeshBasicMaterial).map ?? null
  material = new THREE.MeshBasicMaterial({
    color,
    map,
    transparent: true,
    opacity,
    alphaTest: map ? 0.1 : 0,
    side: source.side,
    depthWrite: false,
    depthFunc: THREE.GreaterDepth,
    stencilWrite: true,
    stencilRef: MARK,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.KeepStencilOp,
    stencilZFail: THREE.KeepStencilOp,
    stencilZPass: THREE.KeepStencilOp,
  })
  // Only the texture's alpha is used; the color stays flat.
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      '#ifdef USE_MAP\n  diffuseColor.a *= texture2D( map, vMapUv ).a;\n#endif'
    )
  }
  material.customProgramCacheKey = () => 'silhouette'
  material.userData.sharedMap = true
  byColor.set(key, material)
  return material
}

// Gives every mesh under `root` an outline twin. Cheap to call every frame: meshes that already have one
// are skipped, and ones added later (a new held item, armor) get theirs.
export const addSilhouette = (root: THREE.Object3D, color: string, opacity = 0.55) => {
  const meshes: THREE.Mesh[] = []
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh && !object.userData.silhouetteTwin && !object.userData.hasSilhouette) {
      meshes.push(object as THREE.Mesh)
    }
  })
  for (const mesh of meshes) {
    mesh.userData.hasSilhouette = true
    const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const source of sources) {
      // Mark where the model itself is drawn.
      source.stencilWrite = true
      source.stencilRef = MARK
      source.stencilFunc = THREE.AlwaysStencilFunc
      source.stencilZPass = THREE.ReplaceStencilOp
    }
    const twin = new THREE.Mesh(
      mesh.geometry,
      Array.isArray(mesh.material)
        ? mesh.material.map((source) => twinMaterial(source, color, opacity))
        : twinMaterial(mesh.material, color, opacity)
    )
    twin.userData.silhouetteTwin = true
    // Shares the model's geometry; disposing the model frees it.
    twin.userData.sharedGeometry = true
    // After everything else, so whatever covers the model is already in the depth buffer.
    twin.renderOrder = 40
    twin.raycast = () => {}
    twin.castShadow = false
    mesh.add(twin)
  }
}
