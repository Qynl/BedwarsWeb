import { describe, expect, test } from 'bun:test'
import { addItem, countItem } from '../src/engine/inventory'
import { TOP } from '../src/games/bedwars/maps/arena'
import type { ChestSpot } from '../src/games/bedwars/maps/types'
import { arena, duel, TestClient, ticks } from './room-helpers'

function spot(room: ReturnType<typeof arena>, kind: ChestSpot['kind'], team?: 'red' | 'blue' | 'green' | 'yellow'): ChestSpot {
  const found = room.map.chests?.find((c) => c.kind === kind && (!team || c.team === team))
  if (!found) throw new Error(`no ${kind} chest`)
  return found
}

const held = (c: TestClient, id: string) => c.p.inventory.findIndex((s) => s?.id === id)
const free = (c: TestClient) => c.p.inventory.findIndex((s) => s === null)

/** Stand two blocks in front of a chest, within reach of its centre. */
function standAt(c: TestClient, chest: ChestSpot): void {
  c.put(chest.x + 0.5, TOP, chest.z + 2.5)
}

describe('team and ender chests', () => {
  test('every base has one team chest and one ender chest, resting on the floor', () => {
    const { room } = duel()
    const chests = room.map.chests ?? []
    expect(chests.length).toBe(8)
    expect(chests.filter((c) => c.kind === 'team').map((c) => c.team).sort()).toEqual(['blue', 'green', 'red', 'yellow'])
    expect(chests.filter((c) => c.kind === 'personal').every((c) => c.team === undefined)).toBe(true)
    for (const c of chests) {
      expect(room.world.get(c.x, c.y, c.z)).toBeGreaterThan(0)
      expect(room.world.get(c.x, c.y - 1, c.z)).toBeGreaterThan(0)
      expect(room.world.get(c.x, c.y + 1, c.z)).toBe(0)
    }
  })

  test('a player stores a stack in the team chest and takes it back', () => {
    const { room, a } = duel()
    const chest = spot(room, 'team', 'red')
    standAt(a, chest)
    addItem(a.p.inventory, 'iron', 7)
    a.send({ t: 'chest', x: chest.x, y: chest.y, z: chest.z })
    expect(a.last('chest')?.kind).toBe('team')

    const iron = held(a, 'iron')
    a.send({ t: 'chestSwap', kind: 'team', a: { side: 'inventory', index: iron }, b: { side: 'chest', index: 4 } })
    expect(a.last('chest')?.slots[4]).toEqual({ id: 'iron', count: 7 })
    expect(a.p.inventory[iron]).toBeNull()

    const back = free(a)
    a.send({ t: 'chestSwap', kind: 'team', a: { side: 'chest', index: 4 }, b: { side: 'inventory', index: back } })
    expect(a.last('chest')?.slots[4]).toBeNull()
    expect(a.p.inventory[back]).toEqual({ id: 'iron', count: 7 })
    expect(countItem(a.p.inventory, 'iron')).toBe(7)
  })

  test('the team chest is shared with teammates', () => {
    const room = arena({ teamSize: 2 })
    const a = new TestClient(room, 'Ash')
    const b = new TestClient(room, 'Bea')
    const c = new TestClient(room, 'Cyd')
    a.send({ t: 'team', team: 'red' })
    c.send({ t: 'team', team: 'red' })
    b.send({ t: 'team', team: 'blue' })
    ticks(room, 25)
    const chest = spot(room, 'team', 'red')
    standAt(a, chest)
    addItem(a.p.inventory, 'gold', 3)
    a.send({ t: 'chest', x: chest.x, y: chest.y, z: chest.z })
    a.send({ t: 'chestSwap', kind: 'team', a: { side: 'inventory', index: held(a, 'gold') }, b: { side: 'chest', index: 1 } })

    standAt(c, chest)
    c.send({ t: 'chest', x: chest.x, y: chest.y, z: chest.z })
    expect(c.last('chest')?.slots[1]).toEqual({ id: 'gold', count: 3 })
    const bag = free(c)
    c.send({ t: 'chestSwap', kind: 'team', a: { side: 'chest', index: 1 }, b: { side: 'inventory', index: bag } })
    expect(c.p.inventory[bag]).toEqual({ id: 'gold', count: 3 })
    expect(a.last('chest')?.slots[1]).toBeNull()
  })

  test('another team cannot open your team chest', () => {
    const { room, a, b } = duel()
    const red = spot(room, 'team', 'red')
    standAt(b, red)
    b.send({ t: 'chest', x: red.x, y: red.y, z: red.z })
    expect(b.last('chest')).toBeUndefined()
    expect(b.events('error').some((t) => t.includes("another team's chest"))).toBe(true)

    standAt(a, red)
    a.send({ t: 'chest', x: red.x, y: red.y, z: red.z })
    expect(a.last('chest')?.kind).toBe('team')
  })

  test('the ender chest is personal, survives death, and can be opened at any base', () => {
    const { room, a, b } = duel()
    const red = spot(room, 'personal')
    standAt(a, red)
    addItem(a.p.inventory, 'diamond', 2)
    a.send({ t: 'chest', x: red.x, y: red.y, z: red.z })
    expect(a.last('chest')?.kind).toBe('personal')
    a.send({ t: 'chestSwap', kind: 'personal', a: { side: 'inventory', index: held(a, 'diamond') }, b: { side: 'chest', index: 0 } })
    expect(a.p.chest[0]).toEqual({ id: 'diamond', count: 2 })

    room.die(a.p, 'void')
    expect(a.p.chest[0]).toEqual({ id: 'diamond', count: 2 })
    expect(a.last('chest')?.kind).toBeNull()
    expect(countItem(a.p.inventory, 'diamond')).toBe(0)

    // Any base's ender chest opens the same private storage, including an enemy's.
    const blue = spot(room, 'personal')
    ticks(room, 60)
    standAt(b, blue)
    b.send({ t: 'chest', x: blue.x, y: blue.y, z: blue.z })
    expect(b.last('chest')?.kind).toBe('personal')
    expect(b.last('chest')?.slots.every((s) => s === null)).toBe(true)
  })

  test('a closed chest stops sending updates, and bad slot references are ignored', () => {
    const { room, a } = duel()
    const chest = spot(room, 'team', 'red')
    standAt(a, chest)
    addItem(a.p.inventory, 'iron', 1)
    const iron = held(a, 'iron')
    a.send({ t: 'chest', x: chest.x, y: chest.y, z: chest.z })
    a.send({ t: 'chestSwap', kind: 'team', a: { side: 'inventory', index: iron }, b: { side: 'chest', index: 99 } })
    expect(a.p.inventory[iron]).toEqual({ id: 'iron', count: 1 })

    a.send({ t: 'chestClose' })
    expect(a.last('chest')?.kind).toBeNull()
    a.send({ t: 'chestSwap', kind: 'team', a: { side: 'inventory', index: iron }, b: { side: 'chest', index: 0 } })
    expect(a.p.inventory[iron]).toEqual({ id: 'iron', count: 1 })
    expect(a.p.team && room.teams.get(a.p.team)?.chest[0]).toBeNull()
  })

  test('chests cannot be opened from across the map or before the round', () => {
    const room = arena()
    const a = new TestClient(room, 'Ash')
    const chest = spot(room, 'team', 'red')
    a.send({ t: 'chest', x: chest.x, y: chest.y, z: chest.z })
    expect(a.last('chest')).toBeUndefined()
    ticks(room, 25)
    a.put(chest.x + 30, TOP, chest.z)
    a.send({ t: 'chest', x: chest.x, y: chest.y, z: chest.z })
    expect(a.last('chest')).toBeUndefined()
  })
})
