/**
 * Local progression: shards, experience and which cosmetics are unlocked.
 * Cosmetics are bought in the wardrobe and worn from the look code, so this
 * file only decides what a player owns. Stored on this device.
 */

export type CosmeticField = 'cape' | 'trail' | 'killEffect'

export interface Profile {
  shards: number
  xp: number
  kills: number
  finals: number
  beds: number
  wins: number
  games: number
  /** `field:index` keys for every bought cosmetic. */
  unlocked: string[]
}

export const EMPTY_PROFILE: Profile = { shards: 0, xp: 0, kills: 0, finals: 0, beds: 0, wins: 0, games: 0, unlocked: [] }

export const REWARDS = {
  kill: { shards: 6, xp: 12 },
  final: { shards: 14, xp: 30 },
  bed: { shards: 35, xp: 70 },
  win: { shards: 75, xp: 150 },
  loss: { shards: 12, xp: 25 },
} as const

export type RewardKind = keyof typeof REWARDS

/** Shard price per choice, in the same order as the lists in look.ts. 0 is free from the start. */
export const PRICES: Record<CosmeticField, number[]> = {
  cape: [0, 0, 0, 150, 150, 240, 240, 340, 450],
  trail: [0, 0, 130, 190, 260, 340],
  killEffect: [0, 0, 200, 380],
}

const KEY = 'sky-shard-profile'
const VERSION = 1

/** The level ladder: each level asks for a little more than the last. */
export function levelInfo(xp: number): { level: number; into: number; need: number } {
  const need = (level: number) => 100 + (level - 1) * 60
  let level = 1
  let into = Math.max(0, Math.floor(xp))
  while (into >= need(level)) {
    into -= need(level)
    level++
  }
  return { level, into, need: need(level) }
}

export function cosmeticPrice(field: CosmeticField, index: number): number {
  return PRICES[field]?.[index] ?? 0
}

export function isUnlocked(profile: Profile, field: CosmeticField, index: number): boolean {
  return cosmeticPrice(field, index) === 0 || profile.unlocked.includes(`${field}:${index}`)
}

/** Buys one cosmetic, or returns null when it is already owned or unaffordable. */
export function buyCosmetic(profile: Profile, field: CosmeticField, index: number): Profile | null {
  const key = `${field}:${index}`
  const price = cosmeticPrice(field, index)
  if (price <= 0 || profile.unlocked.includes(key)) return profile
  if (profile.shards < price) return null
  return { ...profile, shards: profile.shards - price, unlocked: [...profile.unlocked, key] }
}

/** Adds the shards and experience for one event, and counts it. */
export function grant(profile: Profile, kind: RewardKind, times = 1): Profile {
  const n = Math.max(1, Math.floor(times))
  const r = REWARDS[kind]
  const next: Profile = {
    ...profile,
    shards: profile.shards + r.shards * n,
    xp: profile.xp + r.xp * n,
  }
  if (kind === 'kill') next.kills += n
  else if (kind === 'final') next.finals += n
  else if (kind === 'bed') next.beds += n
  else if (kind === 'win') {
    next.wins += n
    next.games += n
  } else next.games += n
  return next
}

const count = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback)

export function parseProfile(raw: unknown): Profile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Profile, unknown>>
  const unlocked = Array.isArray(r.unlocked) ? r.unlocked.filter((k): k is string => typeof k === 'string').slice(0, 64) : []
  return {
    shards: count(r.shards),
    xp: count(r.xp),
    kills: count(r.kills),
    finals: count(r.finals),
    beds: count(r.beds),
    wins: count(r.wins),
    games: count(r.games),
    unlocked,
  }
}

export function loadProfile(): Profile {
  try {
    return parseProfile(JSON.parse(localStorage.getItem(KEY) ?? '{}'))
  } catch {
    return { ...EMPTY_PROFILE, unlocked: [] }
  }
}

export function saveProfile(profile: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...profile, version: VERSION }))
  } catch {}
}
