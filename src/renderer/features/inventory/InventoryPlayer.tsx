import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { MotionEntity } from '../../../shared/types'
import { buildEntityModel, lookOf } from '../watcher/entity/appearance'
import { createAnimator } from '../watcher/entity/animation'
import { disposeObject } from '../watcher/sceneUtils'

const InventoryPlayer: React.FC = () => {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = host.current!
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(element.clientWidth, element.clientHeight)
    element.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.add(new THREE.AmbientLight(0xffffff, 2))
    const light = new THREE.DirectionalLight(0xffffff, 2)
    light.position.set(-3, 5, 4)
    scene.add(light)
    const camera = new THREE.OrthographicCamera(-0.65, 0.65, 1.08, -1.08, 0.1, 20)
    camera.position.set(0, 0.95, -5)
    camera.lookAt(0, 0.95, 0)
    let model: ReturnType<typeof buildEntityModel> = null
    let animator: ReturnType<typeof createAnimator> | null = null
    let appearance = ''
    let mouseX = 0,
      mouseY = 0,
      yaw = 0,
      pitch = 0
    const update = (entity: MotionEntity) => {
      const next = lookOf(entity)
      if (next === appearance) return
      appearance = next
      if (model) disposeObject(model.root)
      model = buildEntityModel(entity)
      animator = model ? createAnimator(model) : null
      if (model) scene.add(model.root)
    }
    update({
      id: -1,
      kind: 'player',
      type: 'player',
      item: null,
      name: 'Bot',
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      headYaw: 0,
      pitch: 0,
      swing: 0,
      hurt: 0,
    })
    const unsubscribe = window.electronAPI.bot.onMotion((motion) =>
      update({
        ...motion.bot,
        id: -1,
        kind: 'player',
        type: 'player',
        item: null,
        name: 'Bot',
        skin: motion.bot.skin ?? undefined,
        cape: motion.bot.cape ?? undefined,
      })
    )
    const move = (event: MouseEvent) => {
      const rect = element.getBoundingClientRect()
      mouseX = Math.atan((event.clientX - rect.left - rect.width / 2) / 180)
      mouseY = Math.atan((event.clientY - rect.top - rect.height * 0.25) / 180)
    }
    window.addEventListener('mousemove', move)
    let frame = 0,
      previous = performance.now()
    const render = (now: number) => {
      const delta = Math.min((now - previous) / 1000, 0.1)
      previous = now
      yaw += (mouseX - yaw) * (1 - Math.exp(-delta * 12))
      pitch += (mouseY - pitch) * (1 - Math.exp(-delta * 12))
      if (model) model.root.rotation.y = yaw * 0.45
      animator?.update({
        now: now / 1000,
        delta,
        stride: 0,
        walk: 0,
        headYaw: yaw * 0.55,
        pitch: -pitch,
        sitting: false,
        crouching: false,
      })
      renderer.render(scene, camera)
      frame = requestAnimationFrame(render)
    }
    frame = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(frame)
      unsubscribe()
      window.removeEventListener('mousemove', move)
      if (model) disposeObject(model.root)
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])
  return <div ref={host} className="mc-player" aria-label="Your character" />
}
export default InventoryPlayer
