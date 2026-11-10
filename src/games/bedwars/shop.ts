import type { ArmorTier, Resource } from './items'

export type OfferCategory = 'blocks' | 'melee' | 'armor' | 'tools' | 'ranged' | 'utility' | 'potions'

export type OfferGive =
  | { kind: 'item'; item: string; count: number }
  | { kind: 'sword'; item: string }
  | { kind: 'armor'; tier: ArmorTier }
  | { kind: 'pickaxe' }
  | { kind: 'axe' }
  | { kind: 'shears' }

export interface Offer {
  id: string
  name: string
  category: OfferCategory
  icon: string
  /** Shown under the name in the shop, like an item's lore. */
  description: string
  /** Also appears in the Quick Buy tab. */
  quick?: boolean
  /** Cost for the next purchase; tools cost more per tier. */
  cost: { resource: Resource; amount: number }[]
  give: OfferGive
}

const iron = (amount: number) => [{ resource: 'iron' as const, amount }]
const gold = (amount: number) => [{ resource: 'gold' as const, amount }]
const emerald = (amount: number) => [{ resource: 'emerald' as const, amount }]

export const OFFERS: Offer[] = [
  { id: 'wool', name: 'Wool ×16', category: 'blocks', icon: 'wool', description: '16 blocks. Cheap, quick defence.', quick: true, cost: iron(4), give: { kind: 'item', item: 'wool', count: 16 } },
  { id: 'clay', name: 'Hardened clay ×16', category: 'blocks', icon: 'clay', description: '16 blocks. Tougher than wool.', cost: iron(12), give: { kind: 'item', item: 'clay', count: 16 } },
  { id: 'glass', name: 'Glass ×4', category: 'blocks', icon: 'glass', description: '4 blocks. See-through defence.', cost: iron(12), give: { kind: 'item', item: 'glass', count: 4 } },
  { id: 'planks', name: 'Planks ×16', category: 'blocks', icon: 'planks', description: '16 blocks. Blast-resistant wood.', cost: gold(4), give: { kind: 'item', item: 'planks', count: 16 } },
  { id: 'moonstone', name: 'Moonstone ×12', category: 'blocks', icon: 'moonstone', description: '12 blocks. Strong end stone.', cost: iron(24), give: { kind: 'item', item: 'moonstone', count: 12 } },
  { id: 'obsidian', name: 'Obsidian ×4', category: 'blocks', icon: 'obsidian', description: '4 blocks. Blast-proof.', cost: emerald(4), give: { kind: 'item', item: 'obsidian', count: 4 } },

  { id: 'stone_sword', name: 'Stone sword', category: 'melee', icon: 'stone_sword', description: 'Deals 5 damage. Upgrades your wood sword.', quick: true, cost: iron(10), give: { kind: 'sword', item: 'stone_sword' } },
  { id: 'iron_sword', name: 'Iron sword', category: 'melee', icon: 'iron_sword', description: 'Deals 6 damage.', cost: gold(7), give: { kind: 'sword', item: 'iron_sword' } },
  { id: 'diamond_sword', name: 'Diamond sword', category: 'melee', icon: 'diamond_sword', description: 'Deals 7 damage.', cost: emerald(4), give: { kind: 'sword', item: 'diamond_sword' } },

  { id: 'chain_armor', name: 'Chain armour', category: 'armor', icon: 'chain_armor', description: 'Chain armour. Better than leather.', cost: iron(24), give: { kind: 'armor', tier: 'chain' } },
  { id: 'iron_armor', name: 'Iron armour', category: 'armor', icon: 'iron_armor', description: 'Iron armour. Sturdier.', quick: true, cost: gold(12), give: { kind: 'armor', tier: 'iron' } },
  { id: 'diamond_armor', name: 'Diamond armour', category: 'armor', icon: 'diamond_armor', description: 'Diamond armour. The best.', cost: emerald(6), give: { kind: 'armor', tier: 'diamond' } },

  { id: 'shears', name: 'Shears', category: 'tools', icon: 'shears', description: 'Cut through wool quickly.', cost: iron(20), give: { kind: 'shears' } },
  { id: 'pickaxe', name: 'Pickaxe', category: 'tools', icon: 'wood_pickaxe', description: 'Mine blocks faster. Upgrades each tier.', quick: true, cost: iron(10), give: { kind: 'pickaxe' } },
  { id: 'axe', name: 'Axe', category: 'tools', icon: 'wood_axe', description: 'Chop wood and wool. Upgrades each tier.', cost: iron(10), give: { kind: 'axe' } },

  { id: 'golden_apple', name: 'Golden apple', category: 'utility', icon: 'golden_apple', description: 'Heals 4 hearts on use.', quick: true, cost: gold(3), give: { kind: 'item', item: 'golden_apple', count: 1 } },
  { id: 'shield', name: 'Shield', category: 'utility', icon: 'shield', description: 'Hold right-click to block hits.', cost: gold(5), give: { kind: 'item', item: 'shield', count: 1 } },
  { id: 'pearl', name: 'Rift pearl', category: 'utility', icon: 'pearl', description: 'Teleport to where it lands.', cost: emerald(4), give: { kind: 'item', item: 'pearl', count: 1 } },
  { id: 'bridge_egg', name: 'Bridge egg', category: 'utility', icon: 'bridge_egg', description: 'Builds a bridge below it.', quick: true, cost: emerald(1), give: { kind: 'item', item: 'bridge_egg', count: 1 } },

  { id: 'bow', name: 'Bow', category: 'ranged', icon: 'bow', description: 'Charge and fire arrows.', cost: gold(12), give: { kind: 'item', item: 'bow', count: 1 } },
  { id: 'arrows', name: 'Arrows ×8', category: 'ranged', icon: 'arrow', description: '8 arrows for your bow.', cost: gold(2), give: { kind: 'item', item: 'arrow', count: 8 } },
  { id: 'fireball', name: 'Fireball', category: 'ranged', icon: 'fireball', description: 'Knock players back and break blocks.', quick: true, cost: iron(40), give: { kind: 'item', item: 'fireball', count: 1 } },
  { id: 'tnt', name: 'TNT', category: 'ranged', icon: 'tnt', description: 'Blast a hole in a defence.', cost: gold(4), give: { kind: 'item', item: 'tnt', count: 1 } },

  { id: 'speed_potion', name: 'Speed (30 s)', category: 'potions', icon: 'speed_potion', description: 'Speed I for 30 seconds.', quick: true, cost: emerald(1), give: { kind: 'item', item: 'speed_potion', count: 1 } },
  { id: 'jump_potion', name: 'Jump (30 s)', category: 'potions', icon: 'jump_potion', description: 'Jump Boost for 30 seconds.', cost: emerald(1), give: { kind: 'item', item: 'jump_potion', count: 1 } },
  { id: 'invisibility_potion', name: 'Invisibility (30 s)', category: 'potions', icon: 'invisibility_potion', description: 'Invisibility for 30 seconds.', cost: emerald(2), give: { kind: 'item', item: 'invisibility_potion', count: 1 } },
]

/** Price of the next pickaxe or axe tier: [wood, second, third, diamond]. */
export const TOOL_TIER_COST: { resource: Resource; amount: number }[][] = [iron(10), iron(10), gold(3), gold(6)]

export type UpgradeId = 'sharpness' | 'protection' | 'forge' | 'healPool'

export interface UpgradeDef {
  id: UpgradeId
  name: string
  description: string
  /** Diamond cost per level; the length is the maximum level. */
  levels: number[]
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'sharpness', name: 'Sharpened swords', description: 'Every sword on your team deals one more damage.', levels: [4] },
  { id: 'protection', name: 'Reinforced armour', description: 'Each level removes 4% more damage for your team.', levels: [2, 4, 8, 16] },
  { id: 'forge', name: 'Forge', description: 'Faster iron and gold; emeralds from level 3.', levels: [2, 4, 6, 8] },
  { id: 'healPool', name: 'Heal pool', description: 'Faster regeneration while at your base.', levels: [1] },
]

export type TeamUpgrades = Record<UpgradeId, number>
export const NO_UPGRADES: TeamUpgrades = { sharpness: 0, protection: 0, forge: 0, healPool: 0 }
