import { describe, expect, test } from 'bun:test'
import { blockDig, blockPlace, concat, frame, handshake, heldItemSlot, loginStart, packPosition, parseBlockChange, parseChunk, parseChunkBulk, parseEntityDestroy, parseEntityTeleport, parseHealth, parseMultiBlockChange, parsePosition, parseSpawnMob, parseSpawnPlayer, readPacket, Reader, Writer } from '../src/mcclient/protocol'
import { ChunkStore } from '../src/mcclient/world'

describe('Minecraft 1.8 client protocol', () => {
  test('reads and writes varints and strings', () => {
    const bytes = new Writer().varint(300).string('Steve').i32(-7).u16(25565).finish()
    const reader = new Reader(bytes)
    expect(reader.varint()).toBe(300)
    expect(reader.string()).toBe('Steve')
    expect(reader.i32()).toBe(-7)
    expect(reader.u16()).toBe(25565)
    expect(reader.remaining).toBe(0)
  })

  test('handshake and login start have the 1.8 packet ids', () => {
    const hs = new Reader(handshake('mc.example.net', 25565).subarray(1))
    expect(hs.varint()).toBe(0)
    expect(hs.varint()).toBe(47)
    expect(hs.string()).toBe('mc.example.net')
    expect(hs.u16()).toBe(25565)
    expect(hs.varint()).toBe(2)
    const login = new Reader(loginStart('Alex').subarray(1))
    expect(login.varint()).toBe(0)
    expect(login.string()).toBe('Alex')
  })

  test('parses one packet, leaving a partial next one buffered', () => {
    const a = frame(0x02, new Writer().string('{"text":"hi"}').finish())
    const b = frame(0x00, new Writer().varint(123).finish())
    const first = readPacket(concat(a, b))!
    expect(first.packet.id).toBe(0x02)
    expect(new Reader(first.packet.data).string()).toBe('{"text":"hi"}')
    const second = readPacket(first.rest)!
    expect(second.packet.id).toBe(0x00)
    expect(new Reader(second.packet.data).varint()).toBe(123)
    expect(readPacket(second.rest)).toBeNull()
    expect(readPacket(b.subarray(0, 2))).toBeNull()
  })

  test('compresses packets at or above the threshold and leaves small ones alone', () => {
    const bigPayload = new Uint8Array(500).fill(7)
    const big = frame(0x21, bigPayload, 256)
    const small = frame(0x00, new Writer().varint(5).finish(), 256)
    const bigPacket = readPacket(big, 256)!
    expect(bigPacket.packet.id).toBe(0x21)
    expect(bigPacket.packet.data.length).toBe(500)
    const smallPacket = readPacket(small, 256)!
    expect(smallPacket.packet.id).toBe(0x00)
    expect(new Reader(smallPacket.packet.data).varint()).toBe(5)
  })

  test('parses a 1.8 chunk column with a single section and biomes', () => {
    const section = new Uint8Array(8192 + 4096)
    // Block at local (1, 0, 2): stone (id 1) becomes state 1 << 4.
    const at = (1 + 16 * (2 + 16 * 0)) * 2
    section[at] = 1 << 4
    section[at + 1] = 0
    const payload = concat(section, new Uint8Array(256))
    const packet = concat(
      new Writer().i32(3).i32(-4).bool(true).u16(1).varint(payload.length).finish(),
      payload,
    )
    const chunk = parseChunk(packet)
    expect(chunk.x).toBe(3)
    expect(chunk.z).toBe(-4)
    expect(chunk.blocks[(0 << 8) | (2 << 4) | 1]).toBe(1)
    expect(chunk.blocks[0]).toBe(0)
  })

  test('parses a bulk chunk packet with two columns', () => {
    const section = new Uint8Array(8192 + 4096)
    const meta = new Writer().i32(1).i32(2).u16(1).i32(-1).i32(-2).u16(1).finish()
    const chunk = concat(section, new Uint8Array(256))
    const packet = concat(new Writer().bool(true).varint(2).finish(), meta, chunk, chunk)
    const columns = parseChunkBulk(packet)
    expect(columns.map((c) => [c.x, c.z])).toEqual([[1, 2], [-1, -2]])
    expect(columns[0].blocks.length).toBe(16 * 256 * 16)
  })

  test('merges a ground-up=false chunk update into the old column', () => {
    const blocks = new Uint16Array(16 * 256 * 16)
    blocks[0] = 1
    blocks[16 * 256] = 2
    const store = new ChunkStore()
    store.set({ x: 0, z: 0, blocks, sections: 0b11, full: true })
    const update = new Uint16Array(16 * 256 * 16)
    update.fill(3, 0, 4096)
    store.set({ x: 0, z: 0, blocks: update, sections: 0b1, full: false })
    expect(store.block(0, 0, 0)).toBe(3)
    expect(store.block(0, 16, 0)).toBe(2)
  })

  test('writes block dig, place and hotbar packets for 1.8', () => {
    const dig = new Reader(blockDig(2, 10, 64, -3, 1).subarray(1))
    expect(dig.varint()).toBe(0x07)
    expect(dig.varint()).toBe(2)
    expect(dig.i64()).toBe(packPosition(10, 64, -3))
    expect(dig.i8()).toBe(1)
    const place = new Reader(blockPlace(1, 64, 2, 3, 4).subarray(1))
    expect(place.varint()).toBe(0x08)
    expect(place.i64()).toBe(packPosition(1, 64, 2))
    expect(place.i8()).toBe(3)
    expect(place.i16()).toBe(4)
    expect(place.i8()).toBe(1)
    expect(place.i16()).toBe(0)
    expect(place.i8()).toBe(0)
    expect([place.i8(), place.i8(), place.i8()]).toEqual([8, 8, 8])
    const slot = new Reader(heldItemSlot(5).subarray(1))
    expect(slot.varint()).toBe(0x09)
    expect(slot.i16()).toBe(5)
  })

  test('parses health, spawn, teleport, destroy and multi-block packets', () => {
    const health = parseHealth(concat(new Writer().f32(17.5).varint(18).f32(4.5).finish()))
    expect(health).toEqual({ health: 17.5, food: 18, saturation: 4.5 })

    const spawn = parseSpawnPlayer(new Writer()
      .varint(7).bytes(new Uint8Array(16).fill(0xab))
      .i32(32).i32(64 * 32).i32(-32)
      .i8(0).i8(0).i16(0).finish())
    expect(spawn).toMatchObject({ id: 7, kind: 'player', x: 1, y: 64, z: -1 })
    expect(spawn.uuid).toHaveLength(32)

    const mob = parseSpawnMob(new Writer().varint(9).u8(50).i32(0).i32(65 * 32).i32(0).i8(0).i8(0).i8(0).finish())
    expect(mob).toMatchObject({ id: 9, kind: 'mob', type: 50, y: 65 })

    const teleport = parseEntityTeleport(new Writer().varint(9).i32(16).i32(64 * 32).i32(0).i8(0).i8(0).bool(true).finish())
    expect(teleport).toMatchObject({ id: 9, x: 0.5, y: 64, z: 0 })
    expect(parseEntityDestroy(new Writer().varint(2).varint(7).varint(9).finish())).toEqual([7, 9])

    const multi = parseMultiBlockChange(new Writer().i32(1).i32(-1).varint(2)
      .u8(0x43).u8(70).varint(1 << 4)
      .u8(0x10).u8(65).varint(2 << 4).finish())
    expect(multi).toEqual([
      { x: 20, y: 70, z: -13, id: 1 },
      { x: 17, y: 65, z: -16, id: 2 },
    ])
  })

  test('decodes a 1.8 block_change packed position', () => {
    const packed = (BigInt(10 & 0x3ffffff) << 38n) | (BigInt(64 & 0xfff) << 26n) | BigInt(-3 & 0x3ffffff)
    const bytes = new Uint8Array(8)
    new DataView(bytes.buffer).setBigInt64(0, packed, false)
    const packet = concat(bytes, new Writer().varint(1 << 4).finish())
    expect(parseBlockChange(packet)).toEqual({ x: 10, y: 64, z: -3, id: 1 })
  })

  test('parses the server position and look angles', () => {
    const p = parsePosition(new Writer().f64(10).f64(64).f64(-3).f32(90).f32(-20).i8(0).finish())
    expect(p).toEqual({ x: 10, y: 64, z: -3, yaw: 90, pitch: -20, flags: 0 })
  })
})
