import { expect, test } from 'bun:test'
import { once } from 'node:events'
import { connect } from 'node:net'
import mc from 'minecraft-protocol'
import {
  concat,
  handshake,
  keepAlive,
  loginStart,
  parseChunk,
  readPacket,
  Reader,
} from '../src/mcclient/protocol'

test('the browser client protocol logs into a real 1.8.9 server', async () => {
  const server = mc.createServer({ 'online-mode': false, host: '127.0.0.1', port: 0, version: '1.8.9', motd: 'test' })
  await once(server, 'listening')
  const port = ((server as unknown as { socketServer: { address(): { port: number } } }).socketServer.address()).port
  const socket = connect(port, '127.0.0.1')
  try {
    await once(socket, 'connect')
    let login = false
    let chunk = false
    let alive = false
    let sentAlive = false
    const done = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`timed out: login=${login} chunk=${chunk} keepalive=${alive}`)), 10_000)
      server.on('login', (client: any) => {
        client.on('keep_alive', (packet: { keepAliveId: number }) => {
          if (packet.keepAliveId === 42) alive = true
        })
        client.write('login', { entityId: 1, gameMode: 1, dimension: 0, difficulty: 1, maxPlayers: 20, levelType: 'flat', reducedDebugInfo: false })
        client.write('position', { x: 0, y: 64, z: 0, yaw: 0, pitch: 0, flags: 0 })
        const section = new Uint8Array(8192 + 4096)
        section[(1 + 16 * 2) * 2] = 1 << 4
        client.write('map_chunk', { x: 0, z: 0, groundUp: true, bitMap: 1, chunkData: Buffer.from(concat(section, new Uint8Array(256))) })
        client.write('keep_alive', { keepAliveId: 42 })
      })
      let buffer: Uint8Array = new Uint8Array(0)
      let threshold = -1
      socket.on('data', (data) => {
        buffer = concat(buffer, typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data))
        for (;;) {
          const next = readPacket(buffer, threshold)
          if (!next) break
          buffer = next.rest
          const id = next.packet.id
          if (id === 0x03) {
            threshold = new Reader(next.packet.data).varint()
          } else if (id === 0x02) {
            login = true
          } else if (id === 0x21) {
            const column = parseChunk(next.packet.data)
            expect(column.blocks[(0 << 8) | (2 << 4) | 1]).toBe(1)
            chunk = true
          } else if (id === 0x00 && !sentAlive) {
            sentAlive = true
            socket.write(keepAlive(new Reader(next.packet.data).varint(), threshold))
          }
          if (login && chunk && alive) {
            clearTimeout(timeout)
            resolve()
            return
          }
        }
      })
    })
    socket.write(handshake('127.0.0.1', port))
    socket.write(loginStart('ClientTest'))
    await done
  } finally {
    socket.destroy()
    server.close()
  }
}, 15_000)
