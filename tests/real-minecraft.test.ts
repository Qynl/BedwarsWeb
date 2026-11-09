import { describe, expect, test } from 'bun:test'
import { cleanPlayerName, cleanServerAddress, clientUrl } from '../src/games/bedwars/client/real-minecraft'

describe('real Minecraft launcher', () => {
  test('accepts a host and an optional port', () => {
    expect(cleanServerAddress('play.example.net')).toBe('play.example.net')
    expect(cleanServerAddress('  play.example.net:25565  ')).toBe('play.example.net:25565')
    expect(cleanServerAddress('https://mc.example.net:25565/')).toBe('mc.example.net:25565')
    expect(cleanServerAddress('my_server.example.net')).toBe('my_server.example.net')
  })

  test('rejects schemes, paths, spaces and impossible ports', () => {
    expect(cleanServerAddress('')).toBeNull()
    expect(cleanServerAddress('play.example.net/path')).toBeNull()
    expect(cleanServerAddress('not a host')).toBeNull()
    expect(cleanServerAddress('play.example.net:0')).toBeNull()
    expect(cleanServerAddress('play.example.net:65536')).toBeNull()
    expect(cleanServerAddress(':25565')).toBeNull()
  })

  test('keeps offline names to the Java username alphabet', () => {
    expect(cleanPlayerName('Steve')).toBe('Steve')
    expect(cleanPlayerName('a_b1')).toBe('a_b1')
    expect(cleanPlayerName('')).toBeNull()
    expect(cleanPlayerName('two words')).toBeNull()
    expect(cleanPlayerName('x'.repeat(17))).toBeNull()
  })

  test('builds the upstream client URL with encoded values', () => {
    const url = new URL(clientUrl('mc.example.net:25565', 'Steve', '1.18.2'))
    expect(url.origin).toBe('https://prismarinejs.github.io')
    expect(url.pathname).toBe('/prismarine-web-client/')
    expect(url.searchParams.get('address')).toBe('mc.example.net:25565')
    expect(url.searchParams.get('username')).toBe('Steve')
    expect(url.searchParams.get('version')).toBe('1.18.2')
    expect(new URL(clientUrl('mc.example.net', 'Steve', '')).searchParams.has('version')).toBe(false)
  })
})
