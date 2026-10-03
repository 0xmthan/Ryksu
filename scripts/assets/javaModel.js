// Turns Java entity models into block model elements, for block entities (chests, beds) whose block
// models are empty because the game draws them as entities. Takes the game's entity models: Java ModelPart boxes on a 64×64 texture, placed by the same pose
// transforms the block entity renderers use, then turned into block model elements. Every rotation is a
// multiple of 90°, so the boxes stay axis-aligned.
const rotation = (axis, degrees) => {
  const c = Math.round(Math.cos((degrees * Math.PI) / 180))
  const s = Math.round(Math.sin((degrees * Math.PI) / 180))
  return {
    x: ([x, y, z]) => [x, y * c - z * s, y * s + z * c],
    y: ([x, y, z]) => [x * c + z * s, y, -x * s + z * c],
    z: ([x, y, z]) => [x * c - y * s, x * s + y * c, z],
  }[axis]
}
const translation =
  (dx, dy, dz) =>
  ([x, y, z]) => [x + dx, y + dy, z + dz]
// Like a PoseStack: the last transform pushed applies to the vertex first.
const transformPoint = (transforms, point) => transforms.reduceRight((p, transform) => transform(p), point)

// Corners of each face as picks between from and to, in the order the mesher reads them (its
// FACE_CORNERS), so each corner's UV can be looked up and expressed as uv + rotation.
const MESHER_CORNERS = [
  [
    [0, 1, 1],
    [1, 1, 1],
    [1, 1, 0],
    [0, 1, 0],
  ],
  [
    [0, 0, 0],
    [1, 0, 0],
    [1, 0, 1],
    [0, 0, 1],
  ],
  [
    [1, 0, 0],
    [0, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
  ],
  [
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ],
  [
    [0, 0, 0],
    [0, 0, 1],
    [0, 1, 1],
    [0, 1, 0],
  ],
  [
    [1, 0, 1],
    [1, 0, 0],
    [1, 1, 0],
    [1, 1, 1],
  ],
]
const CORNER_UV = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]
const near = (a, b) => Math.abs(a - b) < 1e-4

// `boxes`: { uv: [u, v], from, size, offset?, rotation?: [x, y, z] degrees } like Java's
// texOffs(u, v).addBox(from, size) with PartPose offset and rotation.
const entityModel = (texture, boxes, transforms) =>
  boxes.map(
    ({ uv: [u, v], from: [x0, y0, z0], size: [w, h, d], offset = [0, 0, 0], rotation: rot = [0, 0, 0] }) => {
      const pose = [
        ...transforms,
        translation(...offset),
        rotation('z', rot[2]),
        rotation('y', rot[1]),
        rotation('x', rot[0]),
      ]
      const [x1, y1, z1] = [x0 + w, y0 + h, z0 + d]
      const corner = (cx, cy, cz) => transformPoint(pose, [cx ? x1 : x0, cy ? y1 : y0, cz ? z1 : z0])
      const [A, B, C, D, E, F, G, H] = [
        corner(0, 0, 0),
        corner(1, 0, 0),
        corner(1, 1, 0),
        corner(0, 1, 0),
        corner(0, 0, 1),
        corner(1, 0, 1),
        corner(1, 1, 1),
        corner(0, 1, 1),
      ]
      // Java's Cube faces: vertices and the texture rectangle [u1, v1, u2, v2] each one takes; the
      // vertices get (u2, v1), (u1, v1), (u1, v2), (u2, v2) in turn.
      const polygons = [
        [
          [F, E, A, B],
          [u + d, v, u + d + w, v + d],
        ],
        [
          [C, D, H, G],
          [u + d + w, v + d, u + d + 2 * w, v],
        ],
        [
          [A, E, H, D],
          [u, v + d, u + d, v + d + h],
        ],
        [
          [B, A, D, C],
          [u + d, v + d, u + d + w, v + d + h],
        ],
        [
          [F, B, C, G],
          [u + d + w, v + d, u + 2 * d + w, v + d + h],
        ],
        [
          [E, F, G, H],
          [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h],
        ],
      ]
      const all = [A, B, C, D, E, F, G, H]
      const min = [0, 1, 2].map((axis) => Math.min(...all.map((p) => p[axis])))
      const max = [0, 1, 2].map((axis) => Math.max(...all.map((p) => p[axis])))
      const faces = {}
      for (const [vertices, [pu1, pv1, pu2, pv2]] of polygons) {
        const uvs = [
          [pu2, pv1],
          [pu1, pv1],
          [pu1, pv2],
          [pu2, pv2],
        ].map(([pu, pv]) => [pu / 4, pv / 4])
        const axis = [0, 1, 2].find((i) => vertices.every((p) => near(p[i], vertices[0][i])))
        const positive = near(vertices[0][axis], max[axis])
        const direction = [positive ? 5 : 4, positive ? 0 : 1, positive ? 3 : 2][axis]
        const wanted = MESHER_CORNERS[direction].map((pick) => {
          const point = pick.map((p, i) => (p ? max[i] : min[i]))
          const index = vertices.findIndex((vertex) => vertex.every((value, i) => near(value, point[i])))
          return uvs[index]
        })
        // The mesher gives corner k the UV CORNER_UV[(k + turns) % 4] of [u1, v2] → [u2, v1].
        for (let turns = 0; turns < 4; turns++) {
          const at = (target) => wanted[[0, 1, 2, 3].find((k) => (k + turns) % 4 === target)]
          const [fu1, fv2] = at(0)
          const [fu2, fv1] = at(2)
          const fits = wanted.every(([wu, wv], k) => {
            const [cu, cv] = CORNER_UV[(k + turns) % 4]
            return near(wu, fu1 + cu * (fu2 - fu1)) && near(wv, fv2 + cv * (fv1 - fv2))
          })
          if (fits) {
            faces[direction] = { t: texture, uv: [fu1, fv1, fu2, fv2], ...(turns ? { r: turns * 90 } : {}) }
            break
          }
        }
        if (!faces[direction]) throw new Error(`No UV fit for an entity model face (${direction})`)
      }
      const round = (value) => Math.round(value * 1e4) / 1e4
      return { from: min.map(round), to: max.map(round), faces }
    }
  )

module.exports = { rotation, translation, entityModel }
