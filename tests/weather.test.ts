import { describe, expect, test } from 'bun:test'
import { STORM_TICKS } from '../src/games/bedwars/rules'
import { sandbox, TestClient, ticks } from './room-helpers'

describe('arena weather', () => {
  test('the sandbox weather command starts a storm that the game view carries', () => {
    const room = sandbox()
    const a = new TestClient(room, 'Ash')
    a.send({ t: 'chat', text: '/weather storm' })
    ticks(room, 1)
    const view = room.gameView()
    expect(view.weather?.kind).toBe('storm')
    expect(view.weather!.left).toBeGreaterThan(STORM_TICKS - 10)
    expect(view.weather!.left).toBeLessThanOrEqual(STORM_TICKS)
  })

  test('clear ends the weather at once', () => {
    const room = sandbox()
    const a = new TestClient(room, 'Ash')
    a.send({ t: 'chat', text: '/weather meteor' })
    ticks(room, 1)
    expect(room.gameView().weather?.kind).toBe('meteor')
    a.send({ t: 'chat', text: '/weather clear' })
    ticks(room, 1)
    expect(room.gameView().weather).toBeNull()
  })
})
