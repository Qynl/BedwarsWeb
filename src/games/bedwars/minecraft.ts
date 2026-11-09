/**
 * A Minecraft: Java Edition gateway.
 *
 * The game itself speaks a small JSON/binary protocol over WebSockets. This
 * module opens a normal Minecraft server on a TCP port, joins the real game as
 * one more player (through the same `Game` WebSocket a browser uses) and
 * translates the world, entities, chat, movement and block edits into Java
 * Edition packets. A vanilla client can therefore walk around the arena and
 * play a round with the bots and anyone in the browser.
 *
 * It is deliberately off the web path: the bridge only runs when its CLI is
 * started (`bun run minecraft`), so the Cloudflare/Sites build and the browser
 * bundle never import `minecraft-protocol`.
 */
import mc from 'minecraft-protocol'
import registryFactory from 'prismarine-registry'
import chunkFactory from 'prismarine-chunk'
import nbt from 'prismarine-nbt'
import WebSocket from 'ws'
import { fromWire } from '../../engine/net/codec'
import { fromBase64, World } from '../../engine/world'
import { BLOCKS, type TeamId } from './blocks'
import { bedwarsCodec, type PlayerView, type ServerMessage, type SelfView } from './protocol'
import { OFFERS, UPGRADES } from './shop'

/** The Java version the gateway speaks. The client must use the same one. */
export const DEFAULT_MC_VERSION = '1.21.8'
export const DEFAULT_MC_PORT = 25565

/** Game block names to Java block ids. Every block in `BLOCKS` has an entry. */
const BLOCK_NAMES: Record<string, string> = {
  Grass: 'grass_block', Dirt: 'dirt', Stone: 'stone', Bedrock: 'bedrock', Planks: 'oak_planks',
  Glass: 'glass', 'Hardened clay': 'terracotta', Moonstone: 'end_stone', Obsidian: 'obsidian',
  Log: 'oak_log', Leaves: 'oak_leaves', Brick: 'bricks', 'White wool': 'white_wool', TNT: 'tnt',
  'red wool': 'red_wool', 'blue wool': 'blue_wool', 'green wool': 'green_wool', 'yellow wool': 'yellow_wool',
  'red bed': 'red_bed', 'blue bed': 'blue_bed', 'green bed': 'green_bed', 'yellow bed': 'yellow_bed',
  Sand: 'sand', Sandstone: 'sandstone', 'Carved sandstone': 'cut_sandstone', Snow: 'snow_block',
  'Snowy dirt': 'snow_block', Ice: 'ice', 'Packed ice': 'packed_ice', Cobblestone: 'cobblestone',
  'Mossy cobblestone': 'mossy_cobblestone', 'Stone bricks': 'stone_bricks', 'Mossy stone bricks': 'mossy_stone_bricks',
  'Cracked stone bricks': 'cracked_stone_bricks', 'Dark planks': 'dark_oak_planks', 'Spruce log': 'spruce_log',
  'Birch log': 'birch_log', 'Spruce leaves': 'spruce_leaves', 'Snowy spruce leaves': 'spruce_leaves',
  'Birch leaves': 'birch_leaves', Quartz: 'quartz_block', 'Quartz pillar': 'quartz_pillar',
  'Orange terracotta': 'orange_terracotta', 'Red terracotta': 'red_terracotta', 'Yellow terracotta': 'yellow_terracotta',
  'Cyan terracotta': 'cyan_terracotta', 'White terracotta': 'white_terracotta', 'Roof tiles': 'red_terracotta',
  Lantern: 'lantern', 'Frost lamp': 'sea_lantern', 'Hay bale': 'hay_block', 'Still water': 'water',
  Gravel: 'gravel', Cactus: 'cactus', 'Gold block': 'gold_block', Poppies: 'poppy', Dandelions: 'dandelion',
  Cornflowers: 'cornflower', 'Tall grass': 'short_grass', 'Wooden pole': 'stripped_oak_log', Chain: 'chain',
  'red stained glass': 'red_stained_glass', 'blue stained glass': 'blue_stained_glass',
  'green stained glass': 'green_stained_glass', 'yellow stained glass': 'yellow_stained_glass',
  'Team chest': 'chest', 'Ender chest': 'ender_chest',
}

/** Shop item ids to Java item ids. */
const ITEM_NAMES: Record<string, string> = {
  wool: 'white_wool', clay: 'terracotta', glass: 'glass', planks: 'oak_planks', moonstone: 'end_stone', obsidian: 'obsidian',
  wood_sword: 'wooden_sword', stone_sword: 'stone_sword', iron_sword: 'iron_sword', diamond_sword: 'diamond_sword',
  wood_pickaxe: 'wooden_pickaxe', iron_pickaxe: 'iron_pickaxe', gold_pickaxe: 'golden_pickaxe', diamond_pickaxe: 'diamond_pickaxe',
  wood_axe: 'wooden_axe', stone_axe: 'stone_axe', iron_axe: 'iron_axe', diamond_axe: 'diamond_axe', shears: 'shears',
  shield: 'shield', golden_apple: 'golden_apple', bow: 'bow', arrow: 'arrow', fireball: 'fire_charge', pearl: 'ender_pearl',
  bridge_egg: 'egg', tnt: 'tnt', speed_potion: 'potion', jump_potion: 'potion', invisibility_potion: 'potion',
  iron: 'iron_ingot', gold: 'gold_ingot', diamond: 'diamond', emerald: 'emerald',
}

const TEAM_WOOL: Record<TeamId, string> = { red: 'red_wool', blue: 'blue_wool', green: 'green_wool', yellow: 'yellow_wool' }

/** A prismarine registry is intentionally untyped here; it changes with every Java release. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Registry = any
type JavaClient = any

/** The Java block state for a game block id, or 0 (air) when the block has no mapping. */
export function blockState(registry: Registry, id: number): number {
  if (id === 0) return 0
  const name = BLOCK_NAMES[BLOCKS[id]?.name ?? '']
  if (name) return registry.blocksByName[name]?.defaultState ?? 0
  // An unknown game block (a test block, or one added after this table) still needs a solid shape.
  return registry.blocksByName.stone?.defaultState ?? 0
}

/** The Java item id for a shop item; team wool becomes the holder's colour. */
export function itemId(registry: Registry, id: string | undefined, team: TeamId | null = null): number {
  if (!id) return 0
  const javaName = id === 'wool' && team ? TEAM_WOOL[team] : ITEM_NAMES[id] ?? id
  return registry.itemsByName[javaName]?.id ?? 0
}

/** The Java block state list, indexed by the game's block ids. */
export function blockStates(registry: Registry): number[] {
  return BLOCKS.map((b) => blockState(registry, b.id))
}

export interface MinecraftBridgeOptions {
  /** The game WebSocket base, e.g. `ws://127.0.0.1:3000/game?world=arena&room=mc&auto=1`. The player's name is appended. */
  gameUrl?: string
  host?: string
  port?: number
  version?: string
  motd?: string
  maxPlayers?: number
  /** Called with connection notices; defaults to nothing (the CLI logs). */
  log?: (line: string) => void
}

export interface MinecraftBridge {
  readonly port: number
  readonly version: string
  close(): void
}

interface ChunkCache {
  key: string
  packets: { name: string; data: unknown }[]
}

const CHUNK_CACHE_LIMIT = 4

/** Starts the Java Edition listener. Resolves once the TCP port is open. */
export async function startMinecraftBridge(options: MinecraftBridgeOptions = {}): Promise<MinecraftBridge> {
  const version = options.version ?? DEFAULT_MC_VERSION
  const registry = registryFactory(version)
  const ChunkColumn = chunkFactory(registry)
  const mcData = (await import('minecraft-data')).default(version)
  const states = blockStates(registry)
  const playerType = registry.entitiesByName.player?.id ?? 0
  const gameUrl = options.gameUrl ?? 'ws://127.0.0.1:3000/game?world=arena&room=mc&auto=1'
  const log = options.log ?? (() => {})
  const port = options.port ?? DEFAULT_MC_PORT

  const server = mc.createServer({
    'online-mode': false,
    host: options.host ?? '127.0.0.1',
    port,
    version,
    motd: options.motd ?? '§6SKYSHARD §7— §fBed Wars, in real Minecraft',
    'max-players': options.maxPlayers ?? 40,
  } as any)
  const chunkCache: ChunkCache[] = []
  const clients = new Set<JavaClient>()

  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const boundPort = ((server as any).socketServer.address() as { port: number }).port
  log(`Minecraft ${version} listening on ${options.host ?? '127.0.0.1'}:${boundPort} (offline mode)`)
  log(`Joining ${gameUrl}`)

  server.on('playerJoin', (client: JavaClient) => {
    clients.add(client)
    bridgePlayer(client)
  })

  function bridgePlayer(client: JavaClient): void {
    const name = String(client.username ?? 'Steve').slice(0, 16)
    const url = new URL(gameUrl)
    url.searchParams.set('name', name)
    const ws = new WebSocket(url)
    const players = new Map<number, PlayerView>()
    let meId = -1
    let world: World | null = null
    let map: { name?: string; spectator?: number[] } | null = null
    let lastTp = 0
    let tpId = 1
    let seq = 0
    let selfPos = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }
    let selected = 0
    let sneak = false
    let sprint = false
    let invKey = ''
    let alive = true
    const send = (packet: string, data: unknown) => {
      try { client.write(packet, data) } catch (error) { log(`packet ${packet} failed: ${String(error)}`) }
    }
    const uuid = (id: number) => `${id.toString(16).padStart(8, '0')}-0000-3000-8000-000000000000`
    const chat = (text: string) => nbt.comp({ text: nbt.string(text) })

    const chunksFor = (w: World): { name: string; data: unknown }[] => {
      // Include the cells, not just the length: late joiners must see the room's edits.
      let hash = 2166136261
      for (let i = 0; i < w.cells.length; i++) hash = Math.imul(hash ^ w.cells[i], 16777619)
      const key = `${w.sx}x${w.sy}x${w.sz}:${w.cells.length}:${hash >>> 0}`
      const cached = chunkCache.find((c) => c.key === key)
      if (cached) return cached.packets
      const packets = buildChunks(w, states, ChunkColumn, registry)
      chunkCache.unshift({ key, packets })
      if (chunkCache.length > CHUNK_CACHE_LIMIT) chunkCache.pop()
      return packets
    }

    const sendJoin = (w: World) => {
      const loginPacket = mcData.loginPacket
      send('login', {
        ...loginPacket,
        entityId: meId,
        isHardcore: false,
        gameMode: 0,
        previousGameMode: -1,
        maxPlayers: options.maxPlayers ?? 40,
        viewDistance: 8,
        simulationDistance: 8,
        reducedDebugInfo: false,
        enableRespawnScreen: true,
        doLimitedCrafting: false,
        enforcesSecureChat: false,
      })
      send('player_info', {
        action: { add_player: true, update_listed: true, update_latency: true },
        data: [{ uuid: uuid(meId), player: { uuid: uuid(meId), name, properties: [] }, listed: 1, latency: 0 }],
      })
      const packets = chunksFor(w)
      send('chunk_batch_start', {})
      for (const packet of packets) send(packet.name, packet.data)
      send('chunk_batch_finished', { batchSize: packets.length })
      const spawn = map?.spectator ?? [w.sx / 2, 48, w.sz / 2]
      send('spawn_position', { location: { x: spawn[0], y: spawn[1], z: spawn[2] }, angle: 0 })
      send('update_view_position', { chunkX: Math.floor(spawn[0] / 16), chunkZ: Math.floor(spawn[2] / 16) })
      send('position', { teleportId: tpId++, x: spawn[0], y: spawn[1], z: spawn[2], dx: 0, dy: 0, dz: 0, yaw: 0, pitch: 0, flags: 0 })
      send('update_time', { age: [0, 0], time: [0, 6000], tickDayTime: true })
      send('system_chat', { content: chat(`§6SKYSHARD §7· §f${map?.name ?? w.sx + '×' + w.sz} §7— ${name}`), isActionBar: false })
    }

    const profile = (p: PlayerView) => {
      send('player_info', {
        action: { add_player: true, update_listed: true, update_latency: true },
        data: [{ uuid: uuid(p.id), player: { uuid: uuid(p.id), name: p.name, properties: [] }, listed: 1, latency: 0 }],
      })
    }
    const spawnEntity = (p: PlayerView) => {
      profile(p)
      send('spawn_entity', {
        entityId: p.id, objectUUID: uuid(p.id), type: playerType,
        x: p.x, y: p.y, z: p.z,
        pitch: Math.round((p.pitch * 127) / (Math.PI / 2)),
        yaw: Math.round((p.yaw * 127) / Math.PI),
        headPitch: 0, objectData: 0, velocity: { x: 0, y: 0, z: 0 },
      })
    }
    const itemSlot = (slot: { id: string; count: number } | null, team: TeamId | null) => slot
      ? { itemCount: Math.max(1, slot.count), itemId: itemId(registry, slot.id, team), addedComponentCount: 0, removedComponentCount: 0, components: [], removeComponents: [] }
      : { itemCount: 0 }

    const openInventory = (s: SelfView) => {
      const items = new Array(46).fill(null).map(() => ({ itemCount: 0 }))
      s.inventory.forEach((slot, i) => { if (i < 9) items[36 + i] = itemSlot(slot, s.team) })
      const key = JSON.stringify(items) + s.selected
      if (key === invKey) return
      invKey = key
      send('window_items', { windowId: 0, stateId: 1, items, carriedItem: { itemCount: 0 } })
    }

    // Java sends position, position_look and flying separately. Coalesce them into one
    // game input per tick: each room input costs movement budget, and three per tick
    // would drain it even at walking speed.
    let dirty = false
    const setMove = (p: { x: number; y: number; z: number; yaw?: number; pitch?: number } | null) => {
      if (!p) return
      selfPos = {
        x: p.x, y: p.y, z: p.z,
        yaw: p.yaw === undefined ? selfPos.yaw : (p.yaw * Math.PI) / 180,
        pitch: p.pitch === undefined ? selfPos.pitch : (p.pitch * Math.PI) / 180,
      }
      dirty = true
    }
    const moveTimer = setInterval(() => {
      if (!dirty || ws.readyState !== WebSocket.OPEN) return
      dirty = false
      ws.send(JSON.stringify({ t: 'input', x: selfPos.x, y: selfPos.y, z: selfPos.z, vx: 0, vy: 0, vz: 0, yaw: selfPos.yaw, pitch: selfPos.pitch, sneak, sprint, shield: false, tp: lastTp, seq: ++seq }))
    }, 50)

    ws.on('open', () => log(`${name} joined the game`))
    ws.on('error', (error) => log(`${name}: game socket error (${String(error)})`))
    ws.on('close', () => {
      clearInterval(moveTimer)
      send('system_chat', { content: chat('§cThe game connection closed.'), isActionBar: false })
      try { client.end('game closed') } catch { /* already gone */ }
    })
    ws.on('message', (data: WebSocket.RawData, binary: boolean) => {
      let m: ServerMessage
      try {
        m = fromWire(bedwarsCodec.decodeServer, binary ? new Uint8Array(data as Buffer) : String(data)) as ServerMessage
      } catch { return }
      switch (m.t) {
        case 'welcome': {
          world = World.decode(fromBase64(m.world))
          map = m.map
          meId = m.id
          lastTp = m.tp
          sendJoin(world)
          break
        }
        case 'tick': {
          for (const delta of m.players) {
            const previous = players.get(delta.id)
            const p = { ...previous, ...delta } as PlayerView
            players.set(delta.id, p)
            if (p.id === meId) continue
            if (!previous) spawnEntity(p)
            else if (delta.x !== undefined) {
              const dx = p.x - (previous.x ?? p.x), dy = p.y - (previous.y ?? p.y), dz = p.z - (previous.z ?? p.z)
              if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 0.001) continue
              if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 4) {
                send('entity_teleport', { entityId: p.id, x: p.x, y: p.y, z: p.z, dx: 0, dy: 0, dz: 0, yaw: (p.yaw * 180) / Math.PI, pitch: (p.pitch * 180) / Math.PI, flags: 0, onGround: false })
              } else {
                send('rel_entity_move', { entityId: p.id, dX: Math.round(dx * 4096), dY: Math.round(dy * 4096), dZ: Math.round(dz * 4096), onGround: false })
              }
            }
          }
          if (m.gone?.length) {
            send('entity_destroy', { entityIds: m.gone })
            send('player_remove', { players: m.gone.map(uuid) })
            for (const id of m.gone) players.delete(id)
          }
          break
        }
        case 'self': {
          const s = m.self
          send('update_health', { health: s.health, food: 20, foodSaturation: 5 })
          openInventory(s)
          if (alive && !s.alive) {
            alive = false
            send('death_combat_event', { playerId: meId, message: chat('§cYou died') })
          } else if (!alive && s.alive) {
            alive = true
            send('respawn', { worldState: (mcData.loginPacket as any).worldState, copyMetadata: 0 })
            send('position', { teleportId: tpId++, x: selfPos.x, y: selfPos.y, z: selfPos.z, dx: 0, dy: 0, dz: 0, yaw: (selfPos.yaw * 180) / Math.PI, pitch: (selfPos.pitch * 180) / Math.PI, flags: 0 })
          }
          break
        }
        case 'blocks':
          for (const [x, y, z, raw] of m.changes) send('block_change', { location: { x, y, z }, type: states[raw & 0x7f] ?? 0 })
          break
        case 'teleport':
          lastTp = m.tp
          selfPos = { x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch }
          send('position', { teleportId: tpId++, x: m.x, y: m.y, z: m.z, dx: 0, dy: 0, dz: 0, yaw: (m.yaw * 180) / Math.PI, pitch: (m.pitch * 180) / Math.PI, flags: 0 })
          break
        case 'event':
          send('system_chat', { content: chat(m.text), isActionBar: false })
          if (m.kind === 'title') {
            send('set_title_text', { text: chat(m.text) })
            send('set_title_time', { fadeIn: 10, stay: 60, fadeOut: 20 })
            if (m.sub) send('set_title_subtitle', { text: chat(m.sub) })
          }
          break
        case 'summary': {
          const winner = m.winner === 'draw' ? 'Draw' : `${m.winner[0].toUpperCase()}${m.winner.slice(1)} wins`
          send('system_chat', { content: chat(`§6${winner}§r — ${m.players.map((p) => `${p.name} ${p.kills}/${p.finals}/${p.beds}`).join(' · ')}`), isActionBar: false })
          break
        }
        default:
          break
      }
    })

    client.on('position', (p: { x: number; y: number; z: number; yaw: number; pitch: number }) => setMove(p))
    client.on('position_look', (p: { x: number; y: number; z: number; yaw: number; pitch: number }) => setMove(p))
    client.on('look', (p: { yaw: number; pitch: number }) => setMove({ ...selfPos, yaw: p.yaw, pitch: p.pitch }))
    client.on('flying', () => setMove(selfPos))
    client.on('player_input', (p: { inputs?: Record<string, boolean> }) => {
      sneak = !!p.inputs?.shift
      sprint = !!p.inputs?.sprint
      dirty = true
    })
    client.on('held_item_slot', (p: { slotId?: number }) => {
      selected = Math.max(0, Math.min(8, p.slotId ?? 0))
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'select', slot: selected }))
    })
    client.on('use_entity', (p: { target: number; mouse: number }) => {
      if (p.mouse === 1 && p.target !== meId && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'attack', target: p.target }))
    })
    client.on('block_dig', (p: { status: number; location: { x: number; y: number; z: number } }) => {
      if (ws.readyState !== WebSocket.OPEN) return
      const target: [number, number, number] = [p.location.x, p.location.y, p.location.z]
      if (p.status === 0) ws.send(JSON.stringify({ t: 'dig', target }))
      else if (p.status === 2) ws.send(JSON.stringify({ t: 'dig', target, done: true }))
      else if (p.status === 1) ws.send(JSON.stringify({ t: 'dig', target: null }))
    })
    client.on('block_place', (p: { location: { x: number; y: number; z: number }; direction: number }) => {
      const face = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][p.direction]
      if (!face || ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ t: 'place', x: p.location.x, y: p.location.y, z: p.location.z, face, slot: selected }))
    })
    client.on('use_item', () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'use' }))
    })
    client.on('chat_message', (p: { message?: string }) => {
      if (p.message && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'chat', text: p.message }))
    })
    client.on('chat_command', (p: { command?: string }) => {
      if (!p.command || ws.readyState !== WebSocket.OPEN) return
      const [command, ...args] = p.command.trim().split(/\s+/)
      if (command === 'buy' && OFFERS.some((o) => o.id === args[0])) return void ws.send(JSON.stringify({ t: 'buy', offer: args[0] }))
      if (command === 'upgrade' && UPGRADES.some((u) => u.id === args[0])) return void ws.send(JSON.stringify({ t: 'upgrade', id: args[0] }))
      if (command === 'shop') {
        const list = OFFERS.map((o) => `${o.id} (${o.cost.map((c) => `${c.amount} ${c.resource}`).join('+')})`).join(', ')
        return void send('system_chat', { content: chat(`§6Shop§r: ${list}`), isActionBar: false })
      }
      ws.send(JSON.stringify({ t: 'chat', text: `/${p.command}` }))
    })
    client.on('end', () => { clearInterval(moveTimer); clients.delete(client); ws.close() })
  }

  return {
    port: boundPort,
    version,
    close() {
      for (const client of clients) { try { client.end('server closing') } catch { /* gone */ } }
      clients.clear()
      server.close()
    },
  }
}

/** Builds the map chunks once for a world. Heightmaps and full sky light keep vanilla's renderer happy. */
function buildChunks(world: World, states: number[], ChunkColumn: any, registry: Registry): { name: string; data: unknown }[] {
  const packets: { name: string; data: unknown }[] = []
  const sections = 24
  const skyLight = Buffer.alloc(2048, 0xff)
  const mask = [[0, (1 << sections) - 1]]
  const heightmap = (x0: number, z0: number): bigint[] => {
    const values: number[] = []
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      let top = 0
      for (let y = world.sy - 1; y >= 0; y--) if (world.get(x0 + x, y, z0 + z)) { top = y + 1; break }
      values.push(top === 0 ? 0 : top + 64)
    }
    const longs: bigint[] = []
    let current = 0n
    values.forEach((value, i) => {
      current |= BigInt(value) << BigInt((i % 7) * 9)
      if (i % 7 === 6 || i === values.length - 1) { longs.push(current); current = 0n }
    })
    return longs
  }
  for (let cx = 0; cx < Math.ceil(world.sx / 16); cx++) for (let cz = 0; cz < Math.ceil(world.sz / 16); cz++) {
    const column = new ChunkColumn({ minY: -64, worldHeight: 384 })
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      const wx = cx * 16 + x, wz = cz * 16 + z
      if (wx >= world.sx || wz >= world.sz) continue
      for (let y = 0; y < world.sy; y++) {
        const id = world.get(wx, y, wz)
        if (id) column.setBlockStateId({ x, y, z }, states[id] || registry.blocksByName.stone.defaultState)
      }
    }
    const heights = heightmap(cx * 16, cz * 16)
    packets.push({
      name: 'map_chunk',
      data: {
        x: cx, z: cz,
        heightmaps: [
          { type: 'world_surface', data: heights },
          { type: 'motion_blocking', data: heights },
        ],
        chunkData: column.dump(),
        blockEntities: [],
        skyLightMask: mask, blockLightMask: [], emptySkyLightMask: [], emptyBlockLightMask: mask,
        skyLight: Array(sections).fill(skyLight), blockLight: [],
      },
    })
  }
  return packets
}
