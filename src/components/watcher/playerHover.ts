import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

export const createPlayerHover = (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) => {
  // With a stencil buffer, for the outlines of models seen through blocks (silhouette.ts).
  const size = renderer.getSize(new THREE.Vector2()).multiplyScalar(renderer.getPixelRatio())
  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, stencilBuffer: true })
  )
  // Preserve the canvas antialiasing while the hover outline is active.
  const samples = renderer.getContextAttributes()?.antialias ? Math.min(4, renderer.capabilities.maxSamples) : 0
  composer.renderTarget1.samples = samples
  composer.renderTarget2.samples = samples
  const renderPass = new RenderPass(scene, camera)
  const outline = new OutlinePass(renderer.getSize(new THREE.Vector2()), scene, camera)
  outline.visibleEdgeColor.set('#7dd3fc')
  outline.hiddenEdgeColor.set('#000000')
  outline.edgeGlow = 1
  outline.edgeThickness = 1.5
  outline.edgeStrength = 0
  const output = new OutputPass()
  composer.addPass(renderPass)
  composer.addPass(outline)
  composer.addPass(output)
  let strength = 0
  return {
    render(object: THREE.Object3D | null, delta: number) {
      if (object) outline.selectedObjects = [object]
      else if (outline.selectedObjects.some(selected => !scene.getObjectById(selected.id))) outline.selectedObjects = []
      strength += ((object ? 3 : 0) - strength) * (1 - Math.exp(-Math.min(delta, .1) * 14))
      outline.edgeStrength = strength
      if (strength > .02 && outline.selectedObjects.length) composer.render(delta)
      else renderer.render(scene, camera)
    },
    resize(width: number, height: number) { composer.setSize(width, height) },
    setPixelRatio(ratio: number) { composer.setPixelRatio(ratio) },
    dispose() { outline.dispose(); output.dispose(); renderPass.dispose(); composer.dispose() },
  }
}
