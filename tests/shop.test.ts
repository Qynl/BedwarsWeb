import { describe, expect, test } from 'bun:test'
import { addItem, countItem } from '../src/engine/inventory'
import { item } from '../src/games/bedwars/items'
import { OFFERS } from '../src/games/bedwars/shop'
import { duel } from './room-helpers'

describe('item shop', () => {
  test('every offer has a description and Quick Buy has a useful starting page', () => {
    expect(OFFERS.every((o) => o.description.length > 0)).toBe(true)
    const quick = OFFERS.filter((o) => o.quick)
    expect(quick.length).toBeGreaterThanOrEqual(8)
    expect(quick.map((o) => o.id)).toContain('wool')
    expect(quick.map((o) => o.id)).toContain('fireball')
    expect(quick.map((o) => o.id)).toContain('iron_armor')
  })

  test('buying a sword upgrades the one in hand instead of leaving two', () => {
    const { room, a } = duel()
    const shop = room.map.npcs.find((n) => n.kind === 'shop' && n.team === 'red')!
    a.put(shop.x, shop.y, shop.z)
    addItem(a.p.inventory, 'iron', 10)
    addItem(a.p.inventory, 'gold', 20)
    a.send({ t: 'buy', offer: 'stone_sword' })
    expect(countItem(a.p.inventory, 'stone_sword')).toBe(1)
    a.send({ t: 'buy', offer: 'iron_sword' })
    expect(countItem(a.p.inventory, 'iron_sword')).toBe(1)
    const swords = a.p.inventory.filter((s) => s && item(s.id)?.kind === 'sword')
    expect(swords.length).toBe(1)
    expect(swords[0]).toEqual({ id: 'iron_sword', count: 1 })
  })
})
