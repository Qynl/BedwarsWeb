import type { RoomFactory } from '../../engine/net/room'
import { installBots } from './bots'
import { bedwarsCodec } from './protocol'
import { Room } from './room'
import { arenaRules, hubRules, sandboxRules, scaleTimeline, TIMELINE } from './rules'
import { ARENA_IDS } from './maps/arena'
import { TPS } from './constants'

export interface RoomParams {
  world: 'arena' | 'sandbox' | 'hub'
  room: string
  fast: boolean
  /** Kept off the public room list; friends join with the invite link. */
  private?: boolean
  /**
   * A matchmaking room: it starts on its own ten seconds after the first
   * person arrives, filling empty seats with bots, instead of waiting for a
   * host. The hub's Quick play and arena picks use these.
   */
  auto?: boolean
  /** The arena layout a new matchmaking room starts on. */
  map?: string
}

export function roomParams(params: URLSearchParams): RoomParams {
  const world = params.get('world') === 'sandbox' ? 'sandbox' : params.get('world') === 'hub' ? 'hub' : 'arena'
  return {
    world,
    room: (params.get('room') ?? 'main').replace(/[^a-z0-9-]/gi, '').slice(0, 32) || 'main',
    fast: params.get('fast') === '1',
    private: params.get('private') === '1',
    auto: params.get('auto') === '1',
    map: ARENA_IDS.includes(params.get('map') ?? '') ? params.get('map')! : undefined,
  }
}

/** A bed-wars room with bots installed; `offline` rooms start as soon as their one player arrives. */
export function createBedwarsRoom(p: RoomParams, offline = false): Room {
  const timeline = p.fast ? scaleTimeline(TIMELINE, 10) : TIMELINE
  const rules =
    p.world === 'hub'
      ? hubRules()
      : p.world === 'sandbox'
        ? sandboxRules()
        : arenaRules({
            timeline,
            ...(p.map ? { maps: [p.map, ...ARENA_IDS.filter((id) => id !== p.map)] } : {}),
            // Server rooms are matches, not lobbies: the first person starts the countdown
            // and bots fill the other teams. Nobody has to click Start.
            ...(offline ? { minPlayers: 1, countdownTicks: 5 * 20 } : { minPlayers: 1, countdownTicks: 10 * TPS }),
          })
  const room = new Room({ rules, seed: Math.floor(Math.random() * 1e6) })
  room.params = p
  installBots(room)
  return room
}

/** Rooms for the engine's host: one per world, name and speed. */
export const bedwarsRooms: RoomFactory = {
  key(params) {
    const p = roomParams(params)
    return `${p.world}:${p.room}:${p.fast ? 'fast' : 'normal'}${p.private ? ':private' : ''}${p.auto ? ':auto' : ''}${p.map ? `:${p.map}` : ''}`
  },
  create(params) {
    return createBedwarsRoom(roomParams(params))
  },
  codec: bedwarsCodec,
}
