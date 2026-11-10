/**
 * The small part of the Minecraft: Java Edition 1.8.9 protocol needed to join
 * an offline-mode server and walk around. No Mojang code or assets live here:
 * packet ids and field layouts are facts of the wire format.
 *
 * Frames are `varint length` + body. After the server sends Set Compression,
 * the body is `varint uncompressedLength` + zlib data (or `0` + plain packet).
 */
import { zlibSync, unzlibSync } from 'fflate'

export const PROTOCOL_VERSION = 47
export const VERSION_NAME = '1.8.9'
export const MAX_PACKET = 8 * 1024 * 1024

export const C2S = {
  handshake: 0x00,
  loginStart: 0x00,
  keepAlive: 0x00,
  chat: 0x01,
  position: 0x04,
  look: 0x05,
  positionLook: 0x06,
  blockDig: 0x07,
  blockPlace: 0x08,
  heldItem: 0x09,
  animation: 0x0a,
} as const

export const S2C = {
  keepAlive: 0x00,
  joinGame: 0x01,
  chat: 0x02,
  health: 0x06,
  respawn: 0x07,
  position: 0x08,
  heldItem: 0x09,
  spawnPlayer: 0x0c,
  spawnObject: 0x0e,
  spawnMob: 0x0f,
  entityMove: 0x15,
  entityLook: 0x16,
  entityMoveLook: 0x17,
  entityTeleport: 0x18,
  entityHead: 0x19,
  entityDestroy: 0x13,
  chunk: 0x21,
  multiBlockChange: 0x22,
  blockChange: 0x23,
  chunkBulk: 0x26,
  playerInfo: 0x38,
  abilities: 0x39,
  kick: 0x40,
} as const

export interface Packet {
  id: number
  data: Uint8Array
}

export class Reader {
  private view: DataView
  offset = 0

  constructor(private readonly raw: Uint8Array) {
    this.view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  }

  get remaining(): number {
    return this.raw.length - this.offset
  }

  u8(): number {
    if (this.offset + 1 > this.raw.length) throw new Error('packet ended early')
    return this.raw[this.offset++]
  }

  i8(): number {
    const n = this.u8()
    return n > 127 ? n - 256 : n
  }

  u16(): number {
    this.need(2)
    const n = this.view.getUint16(this.offset, false)
    this.offset += 2
    return n
  }

  i16(): number {
    this.need(2)
    const n = this.view.getInt16(this.offset, false)
    this.offset += 2
    return n
  }

  i32(): number {
    this.need(4)
    const n = this.view.getInt32(this.offset, false)
    this.offset += 4
    return n
  }

  u32(): number {
    this.need(4)
    const n = this.view.getUint32(this.offset, false)
    this.offset += 4
    return n
  }

  f32(): number {
    this.need(4)
    const n = this.view.getFloat32(this.offset, false)
    this.offset += 4
    return n
  }

  f64(): number {
    this.need(8)
    const n = this.view.getFloat64(this.offset, false)
    this.offset += 8
    return n
  }

  i64(): bigint {
    this.need(8)
    const n = this.view.getBigInt64(this.offset, false)
    this.offset += 8
    return n
  }

  bool(): boolean {
    return this.u8() !== 0
  }

  varint(): number {
    let value = 0
    let shift = 0
    for (let i = 0; i < 5; i++) {
      const byte = this.u8()
      value |= (byte & 0x7f) << shift
      if ((byte & 0x80) === 0) return value >>> 0
      shift += 7
    }
    throw new Error('varint is too long')
  }

  string(max = 32767): string {
    const length = this.varint()
    if (length > max) throw new Error('string is too long')
    this.need(length)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(this.raw.subarray(this.offset, this.offset + length))
    this.offset += length
    return text
  }

  take(length: number): Uint8Array {
    this.need(length)
    const out = this.raw.subarray(this.offset, this.offset + length)
    this.offset += length
    return out
  }

  private need(n: number): void {
    if (this.offset + n > this.raw.length) throw new Error('packet ended early')
  }
}

export class Writer {
  private parts: number[] = []

  u8(n: number): this {
    this.parts.push(n & 0xff)
    return this
  }

  i8(n: number): this {
    return this.u8(n)
  }

  u16(n: number): this {
    this.parts.push((n >>> 8) & 0xff, n & 0xff)
    return this
  }

  i16(n: number): this {
    return this.u16(n)
  }

  i32(n: number): this {
    this.parts.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff)
    return this
  }

  f32(n: number): this {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setFloat32(0, n, false)
    this.parts.push(...b)
    return this
  }

  f64(n: number): this {
    const b = new Uint8Array(8)
    new DataView(b.buffer).setFloat64(0, n, false)
    this.parts.push(...b)
    return this
  }

  i64(n: bigint): this {
    const b = new Uint8Array(8)
    new DataView(b.buffer).setBigInt64(0, n, false)
    this.parts.push(...b)
    return this
  }

  bool(n: boolean): this {
    return this.u8(n ? 1 : 0)
  }

  varint(value: number): this {
    let n = value >>> 0
    do {
      let byte = n & 0x7f
      n >>>= 7
      if (n !== 0) byte |= 0x80
      this.parts.push(byte)
    } while (n !== 0)
    return this
  }

  string(value: string): this {
    const bytes = new TextEncoder().encode(value)
    this.varint(bytes.length)
    this.parts.push(...bytes)
    return this
  }

  bytes(value: Uint8Array): this {
    this.parts.push(...value)
    return this
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.parts)
  }
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(length)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** Encode a packet for the wire. `threshold` is -1 until Set Compression arrives. */
export function frame(id: number, payload: Uint8Array, threshold = -1): Uint8Array {
  const packet = concat(new Writer().varint(id).finish(), payload)
  if (threshold >= 0 && packet.length >= threshold) {
    const compressed = zlibSync(packet, { level: 6 })
    const body = concat(new Writer().varint(packet.length).finish(), compressed)
    return concat(new Writer().varint(body.length).finish(), body)
  }
  const body = threshold >= 0 ? concat(new Uint8Array([0]), packet) : packet
  return concat(new Writer().varint(body.length).finish(), body)
}

export interface ReadResult {
  packets: Packet[]
  rest: Uint8Array
}

/** Pull the first complete packet out of a byte stream that may split anywhere. */
export function readPacket(input: Uint8Array, threshold = -1): { packet: Packet; rest: Uint8Array } | null {
  const length = readVarint(input, 0)
  if (!length || length.value > MAX_PACKET) return null
  const start = length.size
  const end = start + length.value
  if (end > input.length) return null
  let body = input.subarray(start, end)
  if (threshold >= 0) {
    const size = readVarint(body, 0)
    if (!size) return null
    const data = body.subarray(size.size)
    if (size.value === 0) body = data
    else {
      if (size.value > MAX_PACKET) throw new Error('packet is too large')
      body = unzlibSync(data)
      if (body.length !== size.value) throw new Error('compressed packet size mismatch')
    }
  }
  const id = readVarint(body, 0)
  if (!id) return null
  return { packet: { id: id.value, data: body.subarray(id.size) }, rest: input.subarray(end) }
}

/** Pull every complete packet out of a buffer. */
export function readPackets(input: Uint8Array, threshold = -1): ReadResult {
  const packets: Packet[] = []
  let rest = input
  for (;;) {
    const next = readPacket(rest, threshold)
    if (!next) break
    packets.push(next.packet)
    rest = next.rest
  }
  return { packets, rest }
}

function readVarint(bytes: Uint8Array, offset: number): { value: number; size: number } | null {
  let value = 0
  let shift = 0
  for (let i = 0; i < 5; i++) {
    if (offset + i >= bytes.length) return null
    const byte = bytes[offset + i]
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value: value >>> 0, size: i + 1 }
    shift += 7
  }
  return null
}

export function handshake(host: string, port: number): Uint8Array {
  return frame(C2S.handshake, new Writer().varint(PROTOCOL_VERSION).string(host).u16(port).varint(2).finish())
}

export function loginStart(username: string): Uint8Array {
  return frame(C2S.loginStart, new Writer().string(username).finish())
}

export function clientSettings(viewDistance = 8, threshold = -1): Uint8Array {
  return frame(0x15, new Writer().string('en_US').i8(viewDistance).i8(0).bool(true).u8(0x7f).finish(), threshold)
}

export function keepAlive(id: number, threshold = -1): Uint8Array {
  return frame(C2S.keepAlive, new Writer().varint(id).finish(), threshold)
}

export function chat(message: string, threshold = -1): Uint8Array {
  return frame(C2S.chat, new Writer().string(message.slice(0, 100)).finish(), threshold)
}

export function positionLook(x: number, y: number, z: number, yaw: number, pitch: number, onGround: boolean, threshold = -1): Uint8Array {
  return frame(C2S.positionLook, new Writer().f64(x).f64(y).f64(z).f32(yaw).f32(pitch).bool(onGround).finish(), threshold)
}

/** 1.8 packs a block position into one long: x:26, y:12, z:26. */
export function packPosition(x: number, y: number, z: number): bigint {
  return BigInt.asIntN(64, (BigInt(x & 0x3ffffff) << 38n) | (BigInt(y & 0xfff) << 26n) | BigInt(z & 0x3ffffff))
}

/** status: 0 start, 1 cancel, 2 finish. */
export function blockDig(status: number, x: number, y: number, z: number, face: number, threshold = -1): Uint8Array {
  return frame(C2S.blockDig, new Writer().varint(status).i64(packPosition(x, y, z)).i8(face).finish(), threshold)
}

/** `itemId` is the held block/item; an empty hand is -1. */
export function blockPlace(x: number, y: number, z: number, face: number, itemId: number, threshold = -1): Uint8Array {
  const item = itemId > 0 ? new Writer().i16(itemId).i8(1).i16(0).i8(0) : new Writer().i16(-1)
  return frame(C2S.blockPlace, new Writer()
    .i64(packPosition(x, y, z))
    .i8(face)
    .bytes(item.finish())
    .i8(8).i8(8).i8(8)
    .finish(), threshold)
}

export function heldItemSlot(slot: number, threshold = -1): Uint8Array {
  return frame(C2S.heldItem, new Writer().i16(slot).finish(), threshold)
}

export interface ChunkColumn {
  x: number
  z: number
  /** 16 × 256 × 16 block ids, indexed `(y * 16 + z) * 16 + x`. */
  blocks: Uint16Array
  /** Bitmask of the 16 sections this packet actually carried. */
  sections: number
  /** False for ground-up=false updates, which must be merged into the old column. */
  full: boolean
}

/** 1.8's chunk column: 8192 bytes of block data, 2048 block light and 2048 sky light per section, then biomes. */
export function parseChunk(data: Uint8Array): ChunkColumn {
  const r = new Reader(data)
  const x = r.i32()
  const z = r.i32()
  const groundUp = r.bool()
  const bitMap = r.u16()
  const size = r.varint()
  const payload = r.take(size)
  let sections = 0
  for (let i = 0; i < 16; i++) if ((bitMap & (1 << i)) !== 0) sections++
  // Vanilla overworld columns carry sky light; the nether/end columns do not.
  const skyLight = payload.length >= sections * 12288 + (groundUp ? 256 : 0)
  return { x, z, blocks: parseSections(payload, bitMap, skyLight, groundUp), sections: bitMap, full: groundUp }
}

/** 1.8 sends many columns in one packet at spawn; each meta entry is followed by its section bytes. */
export function parseChunkBulk(data: Uint8Array): ChunkColumn[] {
  const r = new Reader(data)
  const skyLight = r.bool()
  const count = r.varint()
  const metas: { x: number; z: number; bitMap: number }[] = []
  for (let i = 0; i < count; i++) metas.push({ x: r.i32(), z: r.i32(), bitMap: r.u16() })
  const payload = r.take(r.remaining)
  const sections = skyLight ? 12288 : 10240
  const columns: ChunkColumn[] = []
  let at = 0
  for (const meta of metas) {
    const bits = meta.bitMap
    let countBits = 0
    for (let i = 0; i < 16; i++) if ((bits & (1 << i)) !== 0) countBits++
    const size = countBits * sections + 256
    if (at + size > payload.length) break
    columns.push({ x: meta.x, z: meta.z, blocks: parseSections(payload.subarray(at, at + size), bits, skyLight, true), sections: bits, full: true })
    at += size
  }
  return columns
}

function parseSections(payload: Uint8Array, bitMap: number, skyLight: boolean, groundUp: boolean): Uint16Array {
  const blocks = new Uint16Array(16 * 256 * 16)
  let at = 0
  for (let section = 0; section < 16; section++) {
    if ((bitMap & (1 << section)) === 0) continue
    for (let i = 0; i < 4096; i++) {
      if (at + 1 >= payload.length) throw new Error('chunk ended early')
      const state = payload[at] | (payload[at + 1] << 8)
      at += 2
      blocks[section * 4096 + i] = state >> 4
    }
    at += skyLight ? 4096 : 2048
    if (at > payload.length) throw new Error('chunk light ended early')
  }
  if (groundUp) at += 256
  return blocks
}

export interface Position {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
}

export function parsePosition(data: Uint8Array): Position & { flags: number } {
  const r = new Reader(data)
  return { x: r.f64(), y: r.f64(), z: r.f64(), yaw: r.f32(), pitch: r.f32(), flags: r.i8() }
}

export function parseChat(data: Uint8Array): string {
  const r = new Reader(data)
  return r.string(32767)
}

export function parseKick(data: Uint8Array): string {
  return parseChat(data)
}

/** The packed long in 1.8's block_change packet: x:26, y:12, z:26. */
export function parseBlockChange(data: Uint8Array): { x: number; y: number; z: number; id: number } {
  const r = new Reader(data)
  const packed = r.i64()
  const x = Number(packed >> 38n)
  const y = Number((packed >> 26n) & 0xfffn)
  const rawZ = Number(packed & 0x3ffffffn)
  const z = rawZ >= 0x2000000 ? rawZ - 0x4000000 : rawZ
  const state = r.varint()
  return { x, y, z, id: state >> 4 }
}

export interface SpawnedEntity {
  id: number
  kind: 'player' | 'mob' | 'object'
  /** Mob type id, object type id, or 0 for players. */
  type: number
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  uuid?: string
}

function fixed(value: number): number {
  return value / 32
}

function uuidHex(r: Reader): string {
  return [...r.take(16)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 0x0C named_entity_spawn (other players). */
export function parseSpawnPlayer(data: Uint8Array): SpawnedEntity {
  const r = new Reader(data)
  const id = r.varint()
  const uuid = uuidHex(r)
  return {
    id, kind: 'player', type: 0, uuid,
    x: fixed(r.i32()), y: fixed(r.i32()), z: fixed(r.i32()),
    yaw: r.i8() * Math.PI / 128, pitch: r.i8() * Math.PI / 128,
  }
}

/** 0x0F spawn_entity_living (mobs). */
export function parseSpawnMob(data: Uint8Array): SpawnedEntity {
  const r = new Reader(data)
  const id = r.varint()
  const type = r.u8()
  return {
    id, kind: 'mob', type,
    x: fixed(r.i32()), y: fixed(r.i32()), z: fixed(r.i32()),
    yaw: r.i8() * Math.PI / 128, pitch: r.i8() * Math.PI / 128,
  }
}

/** 0x0E spawn_entity (items, arrows, boats, paintings, ...). */
export function parseSpawnObject(data: Uint8Array): SpawnedEntity {
  const r = new Reader(data)
  const id = r.varint()
  const type = r.i8()
  return {
    id, kind: 'object', type,
    x: fixed(r.i32()), y: fixed(r.i32()), z: fixed(r.i32()),
    pitch: r.i8() * Math.PI / 128, yaw: r.i8() * Math.PI / 128,
  }
}

export function parseEntityMove(data: Uint8Array): { id: number; dx: number; dy: number; dz: number } {
  const r = new Reader(data)
  return { id: r.varint(), dx: r.i8() / 32, dy: r.i8() / 32, dz: r.i8() / 32 }
}

export function parseEntityLook(data: Uint8Array): { id: number; yaw: number; pitch: number } {
  const r = new Reader(data)
  return { id: r.varint(), yaw: r.i8() * Math.PI / 128, pitch: r.i8() * Math.PI / 128 }
}

export function parseEntityMoveLook(data: Uint8Array): { id: number; dx: number; dy: number; dz: number; yaw: number; pitch: number } {
  const r = new Reader(data)
  return {
    id: r.varint(), dx: r.i8() / 32, dy: r.i8() / 32, dz: r.i8() / 32,
    yaw: r.i8() * Math.PI / 128, pitch: r.i8() * Math.PI / 128,
  }
}

export function parseEntityTeleport(data: Uint8Array): { id: number; x: number; y: number; z: number; yaw: number; pitch: number } {
  const r = new Reader(data)
  return {
    id: r.varint(),
    x: fixed(r.i32()), y: fixed(r.i32()), z: fixed(r.i32()),
    yaw: r.i8() * Math.PI / 128, pitch: r.i8() * Math.PI / 128,
  }
}

export function parseEntityHead(data: Uint8Array): { id: number; headYaw: number } {
  const r = new Reader(data)
  return { id: r.varint(), headYaw: r.i8() * Math.PI / 128 }
}

export function parseEntityDestroy(data: Uint8Array): number[] {
  const r = new Reader(data)
  const count = r.varint()
  const ids: number[] = []
  for (let i = 0; i < count; i++) ids.push(r.varint())
  return ids
}

export function parseHealth(data: Uint8Array): { health: number; food: number; saturation: number } {
  const r = new Reader(data)
  return { health: r.f32(), food: r.varint(), saturation: r.f32() }
}

/** 0x22 multi_block_change: records are (x<<4|z, y, block state). */
export function parseMultiBlockChange(data: Uint8Array): { x: number; y: number; z: number; id: number }[] {
  const r = new Reader(data)
  const chunkX = r.i32()
  const chunkZ = r.i32()
  const count = r.varint()
  const out: { x: number; y: number; z: number; id: number }[] = []
  for (let i = 0; i < count; i++) {
    const horizontal = r.u8()
    const y = r.u8()
    const state = r.varint()
    out.push({ x: chunkX * 16 + (horizontal >> 4), y, z: chunkZ * 16 + (horizontal & 15), id: state >> 4 })
  }
  return out
}
