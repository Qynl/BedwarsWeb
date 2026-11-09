import { BoxGeometry, Color, Group, InstancedMesh, MeshLambertMaterial, Object3D } from 'three'
import { itemArt, itemPalette } from './icons'

/** How thick each sprite pixel is, in pixels. A sword gets a real back and edge. */
const DEPTH = 3

export interface ItemModel {
  group: Group
  /** The one material behind every voxel, for glint and highlights. */
  material: MeshLambertMaterial
}

/**
 * Extrudes an item's 16×16 pixel art into a voxel model: every opaque pixel
 * becomes a 1×1×3 block, all drawn in one instanced mesh. The old held item
 * was a flat quad, so this gives swords thickness, lit faces and a silhouette
 * that reads from any angle. The group's origin is the handle (sprite pixel
 * 2,13); one sprite pixel is one unit before the caller scales it.
 */
export function itemModel(id: string): ItemModel | null {
  const rows = itemArt(id)
  if (!rows) return null
  const palette = itemPalette(id)
  const pixels: { x: number; y: number; color: string }[] = []
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch !== '.') pixels.push({ x, y, color: palette[ch] })
    }),
  )
  if (pixels.length === 0) return null

  const material = new MeshLambertMaterial({ color: '#ffffff' })
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, DEPTH), material, pixels.length)
  const o = new Object3D()
  const c = new Color()
  pixels.forEach((p, i) => {
    // Sprite rows run top-down; flip them so the blade points up.
    o.position.set(p.x - 2, 13 - p.y, 0)
    o.updateMatrix()
    mesh.setMatrixAt(i, o.matrix)
    mesh.setColorAt(i, c.set(p.color))
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.frustumCulled = false

  const group = new Group()
  group.add(mesh)
  return { group, material }
}
