import { expect, test } from 'bun:test'
import { ChunkStore, isOpaqueBlock, isSolidBlock, playerCollides, raycastBlock } from '../src/mcclient/world'
import type { ChunkColumn } from '../src/mcclient/protocol'

function column(x: number, z: number, blocks: [number, number, number, number][]): ChunkColumn {
  const data = new Uint16Array(16 * 256 * 16)
  for (const [bx, by, bz, id] of blocks) data[(by << 8) | (bz << 4) | bx] = id
  return { x, z, blocks: data, sections: 0xffff, full: true }
}

test('block rules keep water non-solid and glass non-opaque', () => {
  expect(isSolidBlock(1)).toBe(true)
  expect(isSolidBlock(9)).toBe(false)
  expect(isSolidBlock(8)).toBe(false)
  expect(isOpaqueBlock(1)).toBe(true)
  expect(isOpaqueBlock(20)).toBe(false)
  expect(isOpaqueBlock(18)).toBe(false)
  expect(isOpaqueBlock(44)).toBe(false)
  expect(isOpaqueBlock(0)).toBe(false)
})

test('the player box collides with full blocks but not water', () => {
  const store = new ChunkStore()
  store.set(column(0, 0, [[0, 64, 0, 1], [2, 64, 2, 9]]))
  expect(playerCollides(store, 0.5, 64, 0.5)).toBe(true)
  expect(playerCollides(store, 0.5, 65, 0.5)).toBe(false)
  expect(playerCollides(store, 2.5, 64, 2.5)).toBe(false)
})

test('entity raycasts report the block and the face the ray entered', () => {
  const store = new ChunkStore()
  store.set(column(0, 0, [[0, 64, 0, 1], [1, 64, 0, 9]]))
  expect(raycastBlock(store, [0.5, 65.5, 0.5], [0, -1, 0], 6)).toEqual({ x: 0, y: 64, z: 0, face: [0, 1, 0] })
  expect(raycastBlock(store, [1.5, 65.5, 0.5], [0, -1, 0], 6)).toBeNull()
  expect(raycastBlock(store, [0.5, 65.5, 0.5], [0, 1, 0], 6)).toBeNull()
  expect(raycastBlock(store, [0.5, 70, 0.5], [0, -1, 0], 3)).toBeNull()
})
