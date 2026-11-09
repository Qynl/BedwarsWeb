import { describe, expect, test } from 'bun:test'
import { buyCosmetic, cosmeticPrice, EMPTY_PROFILE, grant, isUnlocked, levelInfo, parseProfile } from '../src/games/bedwars/client/profile'

describe('progression', () => {
  test('free cosmetics are owned from the start and paid ones are not', () => {
    expect(cosmeticPrice('cape', 0)).toBe(0)
    expect(cosmeticPrice('cape', 1)).toBe(0)
    expect(cosmeticPrice('cape', 3)).toBeGreaterThan(0)
    expect(isUnlocked(EMPTY_PROFILE, 'cape', 1)).toBe(true)
    expect(isUnlocked(EMPTY_PROFILE, 'cape', 3)).toBe(false)
  })

  test('buying needs shards, then deduces the price and unlocks the choice', () => {
    const poor = { ...EMPTY_PROFILE, shards: 10 }
    expect(buyCosmetic(poor, 'cape', 3)).toBeNull()

    const rich = { ...EMPTY_PROFILE, shards: 500 }
    const bought = buyCosmetic(rich, 'cape', 3)!
    expect(bought).not.toBeNull()
    expect(bought.shards).toBe(500 - cosmeticPrice('cape', 3))
    expect(isUnlocked(bought, 'cape', 3)).toBe(true)
    // Buying it again changes nothing.
    expect(buyCosmetic(bought, 'cape', 3)).toBe(bought)
  })

  test('rewards add shards, xp and the matching count', () => {
    const afterKill = grant(EMPTY_PROFILE, 'kill')
    expect(afterKill.kills).toBe(1)
    expect(afterKill.shards).toBeGreaterThan(0)
    expect(afterKill.xp).toBeGreaterThan(0)

    const afterBed = grant(afterKill, 'bed', 2)
    expect(afterBed.beds).toBe(2)
    expect(afterBed.kills).toBe(1)

    const win = grant(afterBed, 'win')
    expect(win.wins).toBe(1)
    expect(win.games).toBe(1)
  })

  test('levels climb with xp and reset the bar each level', () => {
    expect(levelInfo(0).level).toBe(1)
    expect(levelInfo(0).into).toBe(0)
    const next = levelInfo(levelInfo(0).need)
    expect(next.level).toBe(2)
    expect(next.into).toBe(0)
    expect(levelInfo(10_000).level).toBeGreaterThan(5)
  })

  test('malformed saves fall back to an empty, valid profile', () => {
    expect(parseProfile(null)).toEqual(EMPTY_PROFILE)
    expect(parseProfile({ shards: -5, xp: 'lots', unlocked: [1, 'cape:3', null] })).toEqual({ ...EMPTY_PROFILE, unlocked: ['cape:3'] })
  })
})
