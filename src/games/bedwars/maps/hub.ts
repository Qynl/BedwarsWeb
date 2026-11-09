import { DIRT, GRASS, STONE, STONE_BRICKS, MOSSY_STONE_BRICKS, QUARTZ, QUARTZ_PILLAR, LANTERN, GOLD_BLOCK, GLASS, CHAIN, POLE, DARK_PLANKS, LOG, LEAVES, WOOL, COBBLESTONE, FLOWERS, GRASS_TUFT } from '../blocks'
import { rng } from '../../../engine/random'
import { layeredIsland } from '../../../engine/terrain'
import { World } from '../../../engine/world'
import { Builder } from './builder'
import { broadleaf, lampPost, meadow } from './parts'
import { yawToward } from './arena'
import type { MapDef, Npc } from './types'

/** The floor players walk on: one block above the island's surface. */
const TOP = 30
const SIZE = 112
const MID = SIZE / 2
/** Cell centre of the plaza. */
const C = MID + 0.5

export type HubNpcKind = 'bedwars' | 'practice' | 'solo' | 'wardrobe' | 'rooms'
export type HubNpc = Npc & { kind: HubNpcKind }

/** The arch behind the bed-wars keeper: walking through it joins a match. */
export const HUB_GATE = { x: C, z: MID - 16, halfWidth: 5.5, minY: TOP, maxY: TOP + 4 }

/** Whether a player's feet are in the gate's opening (the client joins a match there). */
export function inHubGate(x: number, y: number, z: number): boolean {
  return Math.abs(x - HUB_GATE.x) <= HUB_GATE.halfWidth && Math.abs(z - HUB_GATE.z) <= 0.7 && y >= HUB_GATE.minY - 0.2 && y <= HUB_GATE.maxY
}

/** Where the hub parkour starts, the pads to touch in order, and its finish. */
export const HUB_PARKOUR = {
  start: [84, TOP + 1, 74] as [number, number, number],
  checkpoints: [
    [84, TOP + 1, 71],
    [86, TOP + 2, 69],
    [84, TOP + 3, 67],
    [82, TOP + 4, 65],
    [84, TOP + 5, 63],
    [86, TOP + 6, 61],
    [84, TOP + 7, 59],
    [82, TOP + 8, 57],
  ] as [number, number, number][],
  finish: [84, TOP + 9, 55] as [number, number, number],
}

/**
 * The network's lobby: a floating island plaza with portals to everything the
 * server runs. People spawn on the south path, walk up to a keeper and
 * right-click them to play. The keepers are placeholders the client draws;
 * the world itself only has their podiums, the arch and the parkour tower.
 */
export function createHub(): MapDef {
  const world = new World(SIZE, 64, SIZE)
  const b = new Builder(world)

  layeredIsland(
    world,
    {
      surface: (x, _y, z) => ((x * 7 + z * 13) % 11 === 0 ? MOSSY_STONE_BRICKS : GRASS),
      soil: DIRT,
      rock: STONE,
      accents: [COBBLESTONE, MOSSY_STONE_BRICKS],
    },
    { cx: C, cz: C, rx: 35, rz: 35, top: TOP, depth: 13, seed: 90210, rough: 2.6, squareness: 2.9 },
  )

  // A paved plaza, a wide south path from the spawn, and a court for the keepers.
  for (let x = MID - 14; x <= MID + 14; x++)
    for (let z = MID - 14; z <= MID + 14; z++) {
      const dx = x + 0.5 - C
      const dz = z + 0.5 - C
      const r = Math.hypot(dx, dz)
      if (r > 14) continue
      const ring = r > 12.4
      const inner = r < 3.2
      b.set(x, TOP - 1, z, inner ? QUARTZ : ring ? (x + z) % 2 ? QUARTZ : QUARTZ_PILLAR : (x * 3 + z * 5) % 17 === 0 ? MOSSY_STONE_BRICKS : STONE_BRICKS)
      if (inner) b.set(x, TOP - 2, z, LANTERN)
    }
  // Centre fountain: a quartz pillar with a lantern bowl.
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (Math.abs(x) + Math.abs(z) <= 2) b.set(MID + x, TOP - 1, MID + z, QUARTZ)
  b.set(MID, TOP, MID, QUARTZ_PILLAR)
  b.set(MID, TOP + 1, MID, LANTERN)
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) b.set(MID + dx * 3, TOP, MID + dz * 3, LANTERN)

  // Paths: south from the spawn, north to the keepers, and out to the parkour.
  const path = (x0: number, z0: number, x1: number, z1: number) => {
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const edge = x === x0 || x === x1 || z === z0 || z === z1
        b.set(x, TOP - 1, z, edge ? QUARTZ : STONE_BRICKS)
      }
  }
  path(MID - 3, MID + 12, MID + 3, MID + 24)
  path(MID - 5, MID - 16, MID + 5, MID - 8)
  path(MID + 14, MID - 3, MID + 26, MID + 3)
  for (const [x, z] of [[MID - 5, MID + 16], [MID + 5, MID + 16], [MID - 5, MID + 26], [MID + 5, MID + 26], [MID - 9, MID - 9], [MID + 9, MID - 9]]) lampPost(b, x, TOP, z, POLE, LANTERN, 3)

  // The keepers' court: five quartz podiums, one per gateway.
  const podium = (x: number, z: number, wool: number) => {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) b.set(x + dx, TOP - 1, z + dz, dx === 0 && dz === 0 ? wool : QUARTZ)
  }
  const keepers: { kind: HubNpcKind; x: number; z: number }[] = [
    { kind: 'bedwars', x: MID, z: MID - 14 },
    { kind: 'practice', x: MID - 12, z: MID - 7 },
    { kind: 'solo', x: MID + 12, z: MID - 7 },
    { kind: 'wardrobe', x: MID - 12, z: MID + 7 },
    { kind: 'rooms', x: MID + 12, z: MID + 7 },
  ]
  const wools = [WOOL.red, WOOL.green, WOOL.yellow, WOOL.blue, WOOL.blue]
  keepers.forEach((k, i) => podium(k.x, k.z, wools[i]))
  const npcs: Npc[] = keepers.map((k) => ({ kind: k.kind as unknown as Npc['kind'], x: k.x + 0.5, y: TOP, z: k.z + 0.5, yaw: yawToward(C - (k.x + 0.5), C + 20 - (k.z + 0.5)) }))
  // The bedwars keeper faces the spawn instead of the plaza centre.
  npcs[0].yaw = Math.PI

  // The gate behind the bedwars keeper: quartz pillars, a glass lintel and chains.
  for (const x of [MID - 6, MID + 6]) for (let y = 0; y < 6; y++) b.set(x, TOP + y, MID - 16, QUARTZ_PILLAR)
  for (let x = MID - 6; x <= MID + 6; x++) b.set(x, TOP + 6, MID - 16, x % 2 ? GLASS : QUARTZ)
  for (let x = MID - 4; x <= MID + 4; x++) if (x % 2 === 0) b.set(x, TOP + 5, MID - 16, CHAIN)
  for (const x of [MID - 5, MID + 5]) b.set(x, TOP + 6, MID - 15, LANTERN)
  // A little backdrop of team wool banners, so the hub reads as the game's home.
  for (const [i, wool] of [WOOL.red, WOOL.blue, WOOL.green, WOOL.yellow].entries()) {
    const x = MID - 9 + i * 6
    for (let y = 0; y < 4; y++) for (let dx = 0; dx < 2; dx++) b.set(x + dx, TOP + y, MID - 18, wool)
  }

  // Spawn deck: a quartz ring with the server's name over it.
  for (let dx = -3; dx <= 3; dx++)
    for (let dz = -3; dz <= 3; dz++) b.set(MID + dx, TOP - 1, MID + 20 + dz, Math.abs(dx) === 3 || Math.abs(dz) === 3 ? QUARTZ : Math.abs(dx) + Math.abs(dz) <= 1 ? GOLD_BLOCK : STONE_BRICKS)
  for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) lampPost(b, MID + dx, TOP, MID + 20 + dz, POLE, LANTERN, 3)
  for (const [dx, dz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) {
    b.set(MID + dx, TOP, MID + 20 + dz, LOG)
    b.set(MID + dx, TOP + 1, MID + 20 + dz, LOG)
    for (let lx = -1; lx <= 1; lx++) for (let lz = -1; lz <= 1; lz++) b.deco(MID + dx + lx, TOP + 2, MID + 20 + dz + lz, LEAVES)
  }

  // Parkour: a tower of two-by-two platforms climbing east of the plaza.
  const pad = (x: number, y: number, z: number, finish = false) => {
    for (let dx = -1; dx <= 0; dx++) for (let dz = -1; dz <= 0; dz++) b.set(x + dx, y, z + dz, finish ? GOLD_BLOCK : QUARTZ)
  }
  b.set(HUB_PARKOUR.start[0], HUB_PARKOUR.start[1] - 1, HUB_PARKOUR.start[2], GOLD_BLOCK)
  HUB_PARKOUR.checkpoints.forEach(([x, y, z]) => pad(x, y - 1, z))
  pad(HUB_PARKOUR.finish[0], HUB_PARKOUR.finish[1] - 1, HUB_PARKOUR.finish[2], true)
  // Railings and a lantern on the finish, so the tower is visible from spawn.
  for (const [x, z] of [[HUB_PARKOUR.finish[0] - 2, HUB_PARKOUR.finish[2]], [HUB_PARKOUR.finish[0] + 1, HUB_PARKOUR.finish[2]]]) {
    b.set(x, HUB_PARKOUR.finish[1], z, POLE)
    b.set(x, HUB_PARKOUR.finish[1] + 1, z, LANTERN)
  }

  // Trees and flowers around the rim, clear of the paths and podiums.
  const rnd = rng(4711)
  for (const [x, z] of [[36, 44], [76, 46], [38, 70], [74, 84], [46, 88], [66, 88], [29, 57], [83, 34], [33, 32], [79, 28]]) broadleaf(b, x, TOP, z, rnd, LOG, LEAVES)
  for (const [x, z] of [[34, 50], [78, 52], [40, 78], [72, 78], [50, 88], [62, 88], [30, 62], [84, 44]]) meadow(b, x, TOP, z, rnd, [FLOWERS.red, FLOWERS.yellow, FLOWERS.blue, GRASS_TUFT], [GRASS, MOSSY_STONE_BRICKS], 3, 0.4)

  // A row of benches and planters along the south path.
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
    const x = MID + side * 7
    const z = MID + 22 + i * 2
    b.set(x, TOP - 1, z, DARK_PLANKS)
    b.deco(x, TOP, z, i % 2 ? WOOL.blue : WOOL.red)
  }

  const labels: MapDef['labels'] = [
    { text: 'SKYSHARD NETWORK', x: C, y: TOP + 8.5, z: C + 18 },
    { text: 'Right-click a keeper to play', x: C, y: TOP + 6.5, z: C + 18 },
    { text: 'BEDWARS', x: C, y: TOP + 8.2, z: MID - 16.5 },
    { text: 'Walk through the gate to play', x: C, y: TOP + 7.0, z: MID - 16.5 },
    { text: 'PARKOUR', x: HUB_PARKOUR.finish[0] + 0.5, y: HUB_PARKOUR.finish[1] + 2.4, z: HUB_PARKOUR.finish[2] + 0.5 },
  ]

  return {
    name: 'SKYSHARD Hub',
    world,
    bases: [],
    generators: [],
    npcs,
    labels,
    lobby: { spawn: [C, TOP, MID + 20.5, 0], box: [0, 0, 0, 0, 0, 0] },
    spectator: [C, TOP + 18, MID + 30, 0, -0.4],
    killY: 8,
    build: { minY: 0, maxY: 0, protectedZones: [] },
    sky: '#8fc8ff',
  }
}
