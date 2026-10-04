import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

export const createPlayerHover = (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) => {
  const composer = new EffectComposer(renderer)
  // Preserve the canvas antialiasing while the hover outline is active.
  composer.renderTarget1.samples = Math.min(4, renderer.capabilities.maxSamples)
  composer.renderTarget2.samples = Math.min(4, renderer.capabilities.maxSamples)
  const renderPass = new RenderPass(scene, camera)
  const size = renderer.getSize(new THREE.Vector2())
  const outline = new OutlinePass(size, scene, camera)
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
    dispose() { outline.dispose(); output.dispose(); renderPass.dispose(); composer.dispose() },
  }
}
