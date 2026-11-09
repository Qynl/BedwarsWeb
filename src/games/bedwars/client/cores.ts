import { AdditiveBlending, Color, Group, Mesh, MeshBasicMaterial, OctahedronGeometry } from 'three'
import { TEAM_COLORS, type TeamId } from '../blocks'
import type { MapMeta } from '../maps/types'
import type { TeamView } from '../protocol'

interface Core {
  team: TeamId
  root: Group
  crystal: Mesh
  halo: Mesh
  baseY: number
  seed: number
}

/**
 * The shard core above every team's bed: a floating, turning crystal in the
 * team colour with a soft additive halo. It is drawn only; the bed underneath
 * is still the thing that can be broken. Shattering is a particle burst in
 * game.ts, driven by the bed flag in the game view.
 */
export class ShardCores {
  readonly group = new Group()
  private cores: Core[] = []
  private readonly geometry = new OctahedronGeometry(0.42, 0)

  load(map: MapMeta): void {
    this.clear()
    for (const base of map.bases) {
      const color = new Color(TEAM_COLORS[base.team])
      const crystal = new Mesh(
        this.geometry,
        new MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false }),
      )
      const halo = new Mesh(
        this.geometry,
        new MeshBasicMaterial({ color, transparent: true, opacity: 0.12, blending: AdditiveBlending, depthWrite: false }),
      )
      halo.scale.setScalar(2.2)
      const root = new Group()
      root.add(crystal, halo)
      const x = base.bed.x + base.bed.dx / 2 + 0.5
      const y = base.bed.y + 1.45
      const z = base.bed.z + base.bed.dz / 2 + 0.5
      root.position.set(x, y, z)
      this.group.add(root)
      this.cores.push({ team: base.team, root, crystal, halo, baseY: y, seed: (base.bed.x * 13 + base.bed.z * 7) % 6.28 })
    }
  }

  /** Turns the crystals, bobs them, and hides the ones whose core is gone. */
  update(seconds: number, teams: TeamView[] | null): void {
    for (const core of this.cores) {
      const alive = teams ? (teams.find((t) => t.team === core.team)?.bed ?? true) : true
      core.root.visible = alive
      if (!alive) continue
      core.root.rotation.y = seconds * 0.8 + core.seed
      core.root.position.y = core.baseY + Math.sin(seconds * 1.6 + core.seed) * 0.09
      core.halo.scale.setScalar(2.2 + Math.sin(seconds * 3.1 + core.seed) * 0.3)
      const material = core.crystal.material as MeshBasicMaterial
      material.opacity = 0.82 + Math.sin(seconds * 2.4 + core.seed) * 0.13
    }
  }

  private clear(): void {
    for (const core of this.cores) {
      this.group.remove(core.root)
      ;(core.crystal.material as MeshBasicMaterial).dispose()
      ;(core.halo.material as MeshBasicMaterial).dispose()
    }
    this.cores = []
  }

  dispose(): void {
    this.clear()
    this.geometry.dispose()
  }
}
