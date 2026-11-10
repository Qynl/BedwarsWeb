import { BoxGeometry, Color, Group, InstancedMesh, Mesh, MeshLambertMaterial, Object3D } from 'three'
import { itemArt, itemPalette } from './icons'

/** How thick each sprite pixel is, in pixels. Enough for a real back and edge without a slab. */
const DEPTH = 2

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


/**
 * A proper first-person sword instead of an extruded sprite: a slim blade
 * with a bright edge, a wide guard, a wrapped grip and a pommel. The group's
 * origin is the top of the grip, where the hand closes around it.
 */
export function swordModel(id: string): ItemModel | null {
  const palette = itemPalette(id)
  const blade = new MeshLambertMaterial({ color: palette.m })
  const group = new Group()
  const box = (w: number, h: number, d: number, color: string, x: number, y: number, z = 0, material?: MeshLambertMaterial) => {
    const m = new Mesh(new BoxGeometry(w, h, d), material ?? new MeshLambertMaterial({ color }))
    m.position.set(x, y, z)
    group.add(m)
    return m
  }
  // Blade, its lit edge and a tapered point.
  box(2.4, 10.6, 1.5, palette.m, 0, 7.1, 0, blade)
  box(0.55, 10, 1.7, palette.l, -1.05, 6.9)
  box(1.7, 2.1, 1.5, palette.l, 0, 13.2)
  // Guard, grip and pommel.
  box(7.2, 1.15, 1.9, palette.d, 0, 1.25)
  box(1.7, 3.2, 1.7, palette.h, 0, -0.7)
  box(1.2, 0.5, 1.2, palette.d, 0, -2.3)
  box(2.7, 1.25, 2.1, palette.d, 0, -3)
  group.position.set(0, 0, 0)
  return { group, material: blade }
}
