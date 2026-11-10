import { afterEach, describe, expect, test } from 'bun:test'
import { createServer, type Server } from 'node:http'
import mc from 'minecraft-protocol'
import registryFactory from 'prismarine-registry'
import { createGameHost } from '../src/engine/net/host'
import { bedwarsRooms } from '../src/games/bedwars/server'
import { blockStates, DEFAULT_MC_VERSION, itemId, startMinecraftBridge, type MinecraftBridge } from '../src/games/bedwars/minecraft'

const registry = registryFactory(DEFAULT_MC_VERSION)

describe('Minecraft translation', () => {
  test('every map block has a real Java block state', () => {
    const states = blockStates(registry)
    expect(states.length).toBeGreaterThan(60)
    expect(states[0]).toBe(0)
    expect(states.slice(1).every((state) => state > 0)).toBe(true)
    expect(new Set(states.slice(1)).size).toBeGreaterThan(40)
  })

  test('team wool and shop items become the Java item the player expects', () => {
    expect(itemId(registry, 'wool', 'red')).toBe(registry.itemsByName.red_wool.id)
    expect(itemId(registry, 'wool', 'blue')).toBe(registry.itemsByName.blue_wool.id)
    expect(itemId(registry, 'diamond_sword')).toBe(registry.itemsByName.diamond_sword.id)
    expect(itemId(registry, 'gold')).toBe(registry.itemsByName.gold_ingot.id)
    expect(itemId(registry, undefined)).toBe(0)
  })
})

describe('the Java gateway', () => {
  let server: Server | null = null
  let bridge: MinecraftBridge | null = null
  afterEach(() => {
    bridge?.close()
    server?.close()
    bridge = null
    server = null
  })

  test('a vanilla-protocol client logs in, receives the arena and can chat', async () => {
    const host = createGameHost(bedwarsRooms)
    server = createServer()
    server.on('upgrade', (req, socket, head) => host.handleUpgrade(req, socket, head))
    await new Promise<void>((ok) => server!.listen(0, '127.0.0.1', ok))
    const gamePort = (server.address() as { port: number }).port
    bridge = await startMinecraftBridge({
      port: 0,
      host: '127.0.0.1',
      version: DEFAULT_MC_VERSION,
      gameUrl: `ws://127.0.0.1:${gamePort}/game?world=sandbox&room=mc-test`,
    })

    const status = await mc.ping({ host: '127.0.0.1', port: bridge.port, version: DEFAULT_MC_VERSION }) as any
    expect(status.version.name).toContain('1.21.8')
    expect(status.players.max).toBe(40)
    expect(status.description?.text ?? status.description).toContain('SKYSHARD')

    const client = mc.createClient({ host: '127.0.0.1', port: bridge.port, username: 'JavaTester', version: DEFAULT_MC_VERSION, auth: 'offline' }) as any
    const chunks: number[] = []
    let login: any = null
    let inventory: any = null
    const chat: string[] = []
    let finished: () => void = () => {}
    const done = new Promise<void>((resolve) => { finished = resolve })
    client.on('login', (packet: { entityId: number }) => { login = packet })
    client.on('map_chunk', (packet: { x: number; z: number }) => chunks.push(packet.x * 100 + packet.z))
    client.on('window_items', (packet: { windowId: number; items: { itemId: number; itemCount: number }[] }) => {
      if (packet.windowId === 0 && packet.items.length >= 46) inventory = packet
    })
    client.on('system_chat', (packet: { content: { value?: { text?: { value?: string } } } }) => {
      const text = packet.content?.value?.text?.value
      if (!text) return
      chat.push(text)
      if (text.includes('JavaTester: hello from Java')) finished()
    })
    client.on('error', (error: Error) => { throw error })

    // Wait for the join packets, then send a chat line through the Java client.
    const deadline = Date.now() + 15_000
    while (!login || chunks.length < 36 || !inventory) {
      if (Date.now() > deadline) throw new Error(`join timed out: login=${!!login} chunks=${chunks.length} inventory=${!!inventory}`)
      await new Promise((ok) => setTimeout(ok, 50))
    }
    expect(login!.entityId).toBeGreaterThan(0)
    expect(chunks.length).toBe(36)
    // Sandbox kit: the second hotbar slot is the team's wool.
    expect(inventory!.items[37]).toMatchObject({ itemId: registry.itemsByName.red_wool.id, itemCount: 64 })
    client.write('chat_message', { message: '!hello from Java', timestamp: BigInt(Date.now()), salt: 0n, signature: null, offset: 0, acknowledged: Buffer.alloc(3), checksum: 0 })
    await done
    expect(chat.some((line) => line.includes('JavaTester: hello from Java'))).toBe(true)
    client.end('test done')
    host.close()
  }, 30_000)

  test('the optional whitelist turns away other Java names', async () => {
    const host = createGameHost(bedwarsRooms)
    server = createServer()
    server.on('upgrade', (req, socket, head) => host.handleUpgrade(req, socket, head))
    await new Promise<void>((ok) => server!.listen(0, '127.0.0.1', ok))
    const gamePort = (server.address() as { port: number }).port
    bridge = await startMinecraftBridge({
      port: 0,
      host: '127.0.0.1',
      version: DEFAULT_MC_VERSION,
      gameUrl: `ws://127.0.0.1:${gamePort}/game?world=sandbox&room=mc-whitelist`,
      whitelist: ['Allowed'],
    })
    const blocked = mc.createClient({ host: '127.0.0.1', port: bridge.port, username: 'Blocked', version: DEFAULT_MC_VERSION, auth: 'offline' }) as any
    const kicked = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('whitelist client was not disconnected')), 5000)
      blocked.on('kick_disconnect', () => { clearTimeout(timer); resolve('kick') })
      blocked.on('end', () => { clearTimeout(timer); resolve('end') })
    })
    expect(['kick', 'end']).toContain(kicked)
    host.close()
  }, 15_000)
})
