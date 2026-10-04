import React from 'react'
import type { ItemIconInfo } from '../utils/itemIcons'

// Cube edge in px; the drawn cube is about 1.6× this tall.
const FACE = 19

// Same view as the game's inventory: tilted down 30°, turned 45°, sides darker than the top.
const FACE_TRANSFORMS = [
  { transform: `rotateX(90deg) translateZ(${FACE / 2}px)`, brightness: 1 },
  { transform: `translateZ(${FACE / 2}px)`, brightness: 0.8 },
  { transform: `rotateY(90deg) translateZ(${FACE / 2}px)`, brightness: 0.6 },
]

const faceStyle = (src: string, tint: string | null): React.CSSProperties => ({
  backgroundImage: `url(${src})`,
  // Animated textures are tall strips; sizing by width shows just the first frame.
  backgroundSize: '100% auto',
  imageRendering: 'pixelated',
  ...(tint
    ? {
        backgroundColor: tint,
        backgroundBlendMode: 'multiply',
        // Keep the tint off transparent pixels (leaves have holes).
        maskImage: `url(${src})`,
        maskSize: '100% auto',
        WebkitMaskImage: `url(${src})`,
        WebkitMaskSize: '100% auto',
      }
    : {}),
})

// `glint` adds the enchantment shimmer (see itemStack.css).
const ItemIcon: React.FC<{ icon: ItemIconInfo; alt: string; glint?: boolean }> = ({ icon, alt, glint = false }) => {
  if (icon.kind === 'flat') {
    const image = (
      <img
        src={icon.src}
        alt={alt}
        draggable={false}
        className="pointer-events-none h-8 w-8 object-contain [image-rendering:pixelated]"
      />
    )
    if (!glint) return image
    const mask = `url(${icon.src})`
    return (
      <span className="pointer-events-none relative block h-8 w-8">
        {image}
        <span
          className="item-glint absolute inset-0"
          style={{
            maskImage: mask,
            WebkitMaskImage: mask,
            maskSize: 'contain',
            WebkitMaskSize: 'contain',
            maskRepeat: 'no-repeat',
            WebkitMaskRepeat: 'no-repeat',
            maskPosition: 'center',
            WebkitMaskPosition: 'center',
          }}
        />
      </span>
    )
  }

  return (
    <span
      role="img"
      aria-label={alt}
      className={`pointer-events-none flex h-8 w-8 items-center justify-center ${glint ? 'item-glint-glow' : ''}`}
    >
      <span
        className="relative"
        style={{
          width: FACE,
          height: FACE,
          transformStyle: 'preserve-3d',
          transform: 'rotateX(-30deg) rotateY(-45deg)',
        }}
      >
        {icon.faces.map((face, index) => (
          <span
            key={index}
            className="absolute inset-0"
            style={{
              ...faceStyle(face.src, face.tint),
              transform: FACE_TRANSFORMS[index].transform,
              filter: `brightness(${FACE_TRANSFORMS[index].brightness})`,
              backfaceVisibility: 'hidden',
            }}
          />
        ))}
      </span>
    </span>
  )
}

export default ItemIcon
