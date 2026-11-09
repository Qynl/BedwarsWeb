import type { Phase } from '../protocol'

/** One public room, as `/api/rooms` lists it (the room's summary plus who is connected). */
export interface RoomInfo {
  room: string
  world: 'arena' | 'sandbox' | 'hub'
  fast: boolean
  /** A matchmaking room the hub made: it starts on its own. */
  auto?: boolean
  /** The layout's id (skyreach...), for picking a specific arena. */
  mapId?: string
  phase: Phase
  map: string
  /** People in the room, and bots holding seats. */
  players: number
  bots: number
  capacity: number
  connections: number
}

export interface RoomList {
  /** Everyone connected to the server, in any room. */
  online: number
  rooms: RoomInfo[]
}

/** A room to join: what a transfer from the hub carries. */
export interface MatchTarget {
  world: 'arena' | 'sandbox' | 'hub'
  room: string
  /** The layout to start on, for a new room. */
  map?: string
  fast?: boolean
  private?: boolean
  /** The server starts this room on its own after a short countdown. */
  auto?: boolean
  /** Run the room in this browser instead of on the server. */
  offline?: boolean
}

/** The server's room list, or null when there is no server to ask (offline, or it is down). */
export async function fetchRooms(): Promise<RoomList | null> {
  try {
    const r = await fetch('/api/rooms', { cache: 'no-store', signal: AbortSignal.timeout(3000) })
    if (!r.ok) return null
    const body = (await r.json()) as { online: number; rooms: { summary: Omit<RoomInfo, 'connections'>; connections: number }[] }
    return { online: body.online, rooms: body.rooms.map((l) => ({ ...l.summary, connections: l.connections })) }
  } catch {
    return null
  }
}

/** Seats someone joining now would get: free places before a round, bots to replace during one. */
export function openSeats(r: RoomInfo): number {
  if (r.world === 'sandbox') return Math.max(0, r.capacity - r.players)
  return r.phase === 'playing' ? r.bots : Math.max(0, r.capacity - r.players)
}

/**
 * The exact room key for a listed room. A matchmaking room carries its arena
 * and `auto` flag: dropping either would address a different room.
 */
export function joinTarget(r: RoomInfo): MatchTarget {
  if (r.world !== 'arena') return { world: r.world, room: r.room }
  return { world: 'arena', room: r.room, ...(r.auto ? { map: r.mapId, auto: true } : {}), fast: r.fast }
}

/** The arenas the server offers, in the order it lists them. Kept in step with `ARENA_IDS` in maps/arena.ts. */
export const ARENA_IDS = ['skyreach', 'lanterns', 'dunes', 'frostpeak', 'ruins'] as const
/** Their display names, for the hub's map picker and the server list. */
export const ARENA_NAMES: Record<string, string> = { skyreach: 'Skyreach', lanterns: 'Lanterns', dunes: 'Dunes', frostpeak: 'Frostpeak', ruins: 'Ruins' }

/**
 * Where the hub sends someone looking for a bed-wars round. It prefers a
 * matchmaking room the server starts on its own, then any lobby with people
 * in it, then a round with a bot seat to take, and otherwise makes a fresh
 * matchmaking room on the requested arena (a new name, never one in use).
 */
export function pickArenaRoom(rooms: RoomInfo[], mapId?: string, random: () => number = Math.random): MatchTarget {
  const wantMap = (r: RoomInfo) => !mapId || r.mapId === mapId || r.map?.toLowerCase() === mapId
  const joins = (r: RoomInfo): MatchTarget => joinTarget(r)
  const open = rooms.filter((r) => r.world === 'arena' && openSeats(r) > 0 && wantMap(r))
  const lobby = open
    .filter((r) => r.phase === 'waiting' || r.phase === 'countdown')
    .sort((a, b) => Number(!!b.auto) - Number(!!a.auto) || b.players - a.players)[0]
  if (lobby) return joins(lobby)
  const running = open.filter((r) => r.phase === 'playing' && r.bots > 0).sort((a, b) => b.players - a.players)[0]
  if (running) return joins(running)
  const layout = mapId ?? ARENA_IDS[Math.floor(random() * ARENA_IDS.length)]
  const name = freshRoomName(layout, rooms)
  return { world: 'arena', room: name, map: layout, auto: true }
}

/** `skyreach-1`, `skyreach-2`...: the first name on that arena no live room is using. */
export function freshRoomName(mapId: string, rooms: RoomInfo[]): string {
  const used = new Set(rooms.map((r) => r.room))
  for (let n = 1; n < 100; n++) if (!used.has(`${mapId}-${n}`)) return `${mapId}-${n}`
  return `${mapId}-${Math.floor(Math.random() * 900 + 100)}`
}

/** Where Quick play goes: the fullest arena lobby with room, else a round with a bot seat, else none. */
export function bestRoom(rooms: RoomInfo[]): RoomInfo | null {
  const arenas = rooms.filter((r) => r.world === 'arena' && openSeats(r) > 0)
  const lobby = arenas.filter((r) => r.phase === 'waiting' || r.phase === 'countdown').sort((a, b) => b.players - a.players)[0]
  return lobby ?? arenas.filter((r) => r.phase === 'playing').sort((a, b) => b.players - a.players)[0] ?? null
}

export function statusLabel(r: RoomInfo): string {
  if (r.world === 'sandbox') return 'Sandbox'
  if (r.phase === 'waiting') return 'Starting soon'
  if (r.phase === 'countdown') return 'Starting'
  if (r.phase === 'playing') return r.bots > 0 ? `In game, ${r.bots} bot ${r.bots === 1 ? 'seat' : 'seats'} to take` : 'In game, full'
  return 'Round over'
}

/** A link that opens the menu ready to join this room. */
export function inviteLink(room: string, options: { private?: boolean; fast?: boolean; auto?: boolean; map?: string } = {}): string {
  const q = new URLSearchParams({ room })
  if (options.private) q.set('private', '1')
  if (options.fast) q.set('fast', '1')
  if (options.auto) q.set('auto', '1')
  if (options.map) q.set('map', options.map)
  return `${location.origin}${location.pathname}?${q}`
}

const WORDS_A = ['oak', 'iron', 'gold', 'ember', 'frost', 'moss', 'sky', 'dune', 'stone', 'lava']
const WORDS_B = ['fox', 'wolf', 'hawk', 'bear', 'owl', 'lynx', 'crab', 'bee', 'toad', 'yak']

/** A short name for a new room, easy to read out to a friend. */
export function randomRoomName(random: () => number = Math.random): string {
  const pick = (list: string[]) => list[Math.floor(random() * list.length)]
  return `${pick(WORDS_A)}-${pick(WORDS_B)}-${10 + Math.floor(random() * 90)}`
}

/** Room names as the server keeps them (it drops anything else). */
export function cleanRoomName(name: string): string {
  return name.replace(/[^a-z0-9-]/gi, '').slice(0, 32)
}
