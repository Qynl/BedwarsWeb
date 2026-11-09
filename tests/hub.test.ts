import { describe, expect, test } from 'bun:test'
import { blockDef } from '../src/games/bedwars/blocks'
import { ARENA_IDS, freshRoomName, joinTarget, pickArenaRoom, type RoomInfo } from '../src/games/bedwars/client/rooms'
import { createHub, HUB_PARKOUR } from '../src/games/bedwars/maps/hub'
import { createBedwarsRoom, roomParams } from '../src/games/bedwars/server'
import { TestClient, ticks } from './room-helpers'

const params = (q: string) => new URLSearchParams(q)

describe('the server hub', () => {
  test('spawns people on the deck with no team, no kit and no round', () => {
    const room = createBedwarsRoom(roomParams(params('world=hub&room=main')))
    const a = new TestClient(room, 'Ash')
    expect(room.rules.mode).toBe('hub')
    expect(room.phase).toBe('waiting')
    expect(a.p.team).toBeNull()
    expect(a.p.alive).toBe(true)
    expect(a.p.inventory.filter(Boolean)).toEqual([])
    const spawn = room.map.lobby!.spawn
    expect(Math.hypot(a.p.x - spawn[0], a.p.z - spawn[2])).toBeLessThan(0.01)
    ticks(room, 20 * 30)
    expect(room.phase).toBe('waiting')
    expect(room.humans().length).toBe(1)
    // The hub never advertises itself as a game.
    expect(room.summary()).toBeNull()
    expect(room.gameView().teams).toEqual([])
  })

  test('is a safe shared lobby: chat reaches everyone, and the void puts you back on the deck', () => {
    const room = createBedwarsRoom(roomParams(params('world=hub&room=main')))
    const a = new TestClient(room, 'Ash')
    const b = new TestClient(room, 'Bea')
    a.send({ t: 'chat', text: 'anyone for bedwars?' })
    expect(b.events('chat')).toContain('Ash: anyone for bedwars?')
    expect(a.events('system')).toContain('Bea joined')
    a.p.x = 2
    a.p.y = 2
    a.p.z = 2
    ticks(room, 2)
    const spawn = room.map.lobby!.spawn
    expect(a.p.y).toBe(spawn[1])
    expect(Math.hypot(a.p.x - spawn[0], a.p.z - spawn[2])).toBeLessThan(0.01)
    expect(a.p.alive).toBe(true)
  })

  test('has five keepers, each standing on its own podium', () => {
    const map = createHub()
    const kinds = map.npcs.map((n) => n.kind)
    expect(kinds).toEqual(['bedwars', 'practice', 'solo', 'wardrobe', 'rooms'])
    for (const npc of map.npcs) {
      expect(blockDef(map.world.get(Math.floor(npc.x), npc.y - 1, Math.floor(npc.z))).solid).toBe(true)
      expect(map.world.get(Math.floor(npc.x), npc.y, Math.floor(npc.z))).toBe(0)
      expect(map.world.get(Math.floor(npc.x), npc.y + 1, Math.floor(npc.z))).toBe(0)
    }
  })

  test('the parkour pads are solid, reachable steps', () => {
    const map = createHub()
    const pads = [HUB_PARKOUR.start, ...HUB_PARKOUR.checkpoints, HUB_PARKOUR.finish]
    for (const [x, y, z] of pads) {
      expect(blockDef(map.world.get(x, y - 1, z)).solid).toBe(true)
      expect(map.world.get(x, y, z)).toBe(0)
    }
    for (let i = 1; i < pads.length; i++) {
      const [ax, ay, az] = pads[i - 1]
      const [bx, by, bz] = pads[i]
      expect(by - ay).toBeLessThanOrEqual(1)
      const gap = Math.hypot(Math.max(0, Math.abs(ax - bx) - 1), Math.max(0, Math.abs(az - bz) - 1))
      expect(gap).toBeLessThanOrEqual(3)
    }
  })
})

describe('matchmaking from the hub', () => {
  const room = (r: Partial<RoomInfo>): RoomInfo => ({ room: 'r', world: 'arena', fast: false, phase: 'waiting', map: 'Skyreach', mapId: 'skyreach', players: 1, bots: 0, capacity: 4, connections: 1, ...r })

  test('joins a matchmaking lobby with room before making a new one, and keeps its exact key', () => {
    const target = pickArenaRoom([room({ room: 'skyreach-2', auto: true, players: 2 })], 'skyreach')
    expect(target).toEqual({ world: 'arena', room: 'skyreach-2', map: 'skyreach', auto: true, fast: false })
    // A direct-connect room has no auto/map key, so the transfer must not add them.
    expect(pickArenaRoom([room({ room: 'oak-fox-12', players: 2 })], undefined)).toEqual({ world: 'arena', room: 'oak-fox-12', fast: false })
  })

  test('falls back to a bot seat, then to a fresh auto room on the chosen arena', () => {
    const midRound = room({ room: 'dunes-1', mapId: 'dunes', phase: 'playing', players: 3, bots: 1, auto: true })
    expect(pickArenaRoom([midRound], 'dunes')).toMatchObject({ room: 'dunes-1', auto: true })
    const fresh = pickArenaRoom([], 'frostpeak')
    expect(fresh).toMatchObject({ world: 'arena', room: 'frostpeak-1', map: 'frostpeak', auto: true })
    expect(ARENA_IDS).toContain('frostpeak')
    expect(freshRoomName('frostpeak', [room({ room: 'frostpeak-1' })])).toBe('frostpeak-2')
  })

  test('an auto room starts itself with bots when one person arrives', () => {
    const arena = createBedwarsRoom(roomParams(params('world=arena&room=skyreach-1&auto=1&map=skyreach')))
    new TestClient(arena, 'Ash')
    ticks(arena, 11 * 20)
    expect(arena.phase).toBe('playing')
    expect(arena.mapId).toBe('skyreach')
    expect([...arena.players.values()].filter((p) => p.brain).length).toBe(3)
    expect(arena.summary()).toMatchObject({ auto: true, mapId: 'skyreach', players: 1, bots: 3 })
  })

  test('a listed room keeps its exact key when clicked, whatever kind it is', () => {
    expect(joinTarget(room({ room: 'dunes-2', auto: true, mapId: 'dunes', fast: true }))).toEqual({ world: 'arena', room: 'dunes-2', map: 'dunes', auto: true, fast: true })
    expect(joinTarget(room({ room: 'oak-fox-12' }))).toEqual({ world: 'arena', room: 'oak-fox-12', fast: false })
    expect(joinTarget(room({ world: 'sandbox', room: 'practice', phase: 'playing' }))).toEqual({ world: 'sandbox', room: 'practice' })
  })

  test('a matchmaking room never shares a key with the same-named direct room', () => {
    expect(createBedwarsRoom(roomParams(params('room=x&auto=1'))).rules.minPlayers).toBe(1)
    expect(createBedwarsRoom(roomParams(params('room=x'))).rules.minPlayers).toBe(2)
  })
})

describe('kill feed', () => {
  test('first blood and streaks are announced', () => {
    const room = createBedwarsRoom(roomParams(params('room=streaks')))
    const a = new TestClient(room, 'Ash')
    const b = new TestClient(room, 'Bea')
    a.send({ t: 'start' })
    ticks(room, 11 * 20)
    expect(room.phase).toBe('playing')
    for (let i = 0; i < 3; i++) {
      b.p.alive = true
      b.p.health = 20
      room.die(b.p, 'melee', a.p)
    }
    const system = a.events('system')
    expect(system).toContain('First blood: Ash drew first.')
    expect(system.some((t) => t.includes('Ash is on a 3 kill streak!'))).toBe(true)
    expect(b.p.streak).toBe(0)
  })
})
