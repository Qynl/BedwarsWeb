import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  type Texture,
} from 'three'
import { TEAM_COLORS, type TeamId } from '../blocks'
import { item, placedBlock } from '../items'
import type { AtlasLayout } from '../../../engine/render/atlas-layout'
import { blockCube } from '../../../engine/render/entities'
import { itemModel } from './item-models'
import { setBoxUV } from './avatar'

/** The first-person arm and held item, drawn in its own scene over the world. */
export class ViewModel {
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(70, 1, 0.01, 10)
  private hand = new Group()
  private arm: Mesh
  private held: Object3D | null = null
  private heldKey = ''
  private heldGlint: MeshLambertMaterial | null = null
  private glintColor = new Color('#ffffff')
  private glintBase = 0
  private slash: Mesh
  private slashMat: MeshBasicMaterial
  private swing = 1
  private bob = 0
  private walk = 0
  private equip = 1
  private shieldUp = 0
  private impact = 1
  private swayX = 0
  private swayY = 0
  private armMat = new MeshLambertMaterial({ color: '#d9a066' })
  private armOverMat = new MeshLambertMaterial({ transparent: true, alphaTest: 0.5, visible: false })

  constructor(
    private readonly atlas: Texture,
    private readonly layout: AtlasLayout,
  ) {
    this.scene.add(new HemisphereLight(0xffffff, 0x8899aa, 2.2))
    const sun = new DirectionalLight(0xffffff, 1.2)
    sun.position.set(0.4, 1, 0.3)
    this.scene.add(sun)
    // Your own right arm, wearing your skin: the 4×12×4 arm box of the skin texture,
    // laid along the view with the hand forward, plus its outer (armour) layer.
    const s = 0.0275
    const base = new BoxGeometry(4 * s, 12 * s, 4 * s)
    setBoxUV(base, 40, 16, 4, 12, 4)
    const over = new BoxGeometry(4.6 * s, 12.4 * s, 4.6 * s)
    setBoxUV(over, 40, 32, 4, 12, 4)
    this.arm = new Mesh(base, this.armMat)
    const outer = new Mesh(over, this.armOverMat)
    for (const m of [this.arm, outer]) {
      m.rotation.x = Math.PI / 2
      m.position.set(0, -0.02, 0.12)
    }
    this.hand.add(this.arm, outer)
    this.hand.position.set(0.37, -0.34, -0.8)
    this.hand.rotation.set(0.15, 0.2, 0)
    this.scene.add(this.hand)
    // The swing arc: a soft additive streak that follows the blade through the air.
    this.slashMat = new MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    })
    this.slash = new Mesh(new RingGeometry(0.34, 0.62, 28, 1, -0.3, Math.PI * 1.1), this.slashMat)
    this.slash.position.set(0.18, -0.1, -0.9)
    this.slash.renderOrder = 2
    this.slash.visible = false
    this.scene.add(this.slash)
  }

  /** Dresses the arm in your skin texture (from your third-person figure). */
  setSkin(skin: Texture | null) {
    if (!skin || this.armMat.map === skin) return
    this.armMat.map = skin
    this.armMat.color.set('#ffffff')
    this.armOverMat.map = skin
    this.armOverMat.visible = true
    this.armMat.needsUpdate = this.armOverMat.needsUpdate = true
  }

  /** Ticks since the swing began (20 when idle), for the third-person figure. */
  swingTicks(): number {
    return this.swing >= 1 ? 20 : Math.floor(this.swing * 6)
  }

  /** Starts a swing; called on every attack, dig or place. A new click late in a swing restarts it cleanly. */
  swingNow() {
    if (this.swing >= 0.6) this.swing = 0
  }

  /** A short punch of the hand when an attack lands. */
  hitImpact() {
    this.impact = 0
  }

  setHeld(id: string | null, team: TeamId | null) {
    const key = `${id}:${team}`
    if (key === this.heldKey) return
    // Switching items dips the hand out of view and brings the new one up.
    if (this.heldKey) this.equip = 0
    this.heldKey = key
    ;(this.arm.material as MeshLambertMaterial).color.set(team ? TEAM_COLORS[team] : '#9a9a9a')
    if (this.held) this.hand.remove(this.held)
    this.held = null
    this.heldGlint = null
    this.glintBase = 0
    this.slashMat.color.set(team ? TEAM_COLORS[team] : '#ffffff').lerp(new Color('#ffffff'), 0.55)
    const def = item(id ?? undefined)
    if (!def) return
    const block = def.kind === 'block' ? placedBlock(def, team ?? 'red') : def.kind === 'tnt' ? def.block : undefined
    if (block !== undefined) {
      const m = new Mesh(blockCube(this.layout, block), new MeshLambertMaterial({ map: this.atlas, alphaTest: 0.5 }))
      m.scale.setScalar(0.22)
      m.position.set(-0.02, 0.08, -0.06)
      m.rotation.set(0.1, 0.7, 0)
      this.held = m
    } else {
      const model = itemModel(def.id)
      if (!model) return
      const g = model.group
      if (def.kind === 'shield') {
        g.scale.setScalar(0.045)
        g.position.set(-0.01, 0.1, -0.02)
        g.rotation.set(0.05, Math.PI / 2 - 0.15, 0)
      } else if (def.kind === 'sword') {
        // Handle at the group origin, so the blade sweeps up and across the view.
        // A smaller scale keeps the tip near the crosshair instead of filling the screen,
        // and the flatter turn shows the blade's face rather than its edge.
        g.scale.setScalar(0.026)
        g.position.set(-0.03, 0.07, -0.1)
        g.rotation.set(0.12, 0.42, Math.PI / 2 + 0.26)
      } else if (def.kind === 'tool') {
        g.scale.setScalar(0.026)
        g.position.set(-0.03, 0.06, -0.1)
        g.rotation.set(0.16, 0.5, Math.PI / 2 + 0.34)
      } else {
        // Food, potions and the rest sit in the palm and face the camera.
        g.scale.setScalar(0.03)
        g.position.set(-0.02, 0.08, -0.09)
        g.rotation.set(0.1, 0.35, 0.35)
      }
      const tier = def.tier ?? 0
      if (def.kind === 'sword' || def.kind === 'tool') {
        // Metal blades catch a slow enchant-like glint; diamond burns brightest.
        this.glintBase = tier >= 2 ? 0.22 : 0.055
        this.glintColor.set(tier >= 2 ? def.color : '#dfe8ff')
        model.material.emissive.copy(this.glintColor).multiplyScalar(this.glintBase)
      }
      this.heldGlint = model.material
      this.held = g
    }
    this.hand.add(this.held)
  }

  /** Per frame: bob with walking, raise a shield, play the swing, dip on switching items. */
  frame(dt: number, walking: number, shield: boolean, eating: boolean, aspect: number, draw = 0, swayX = 0, swayY = 0) {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
    // Smooth the walk amount so stopping and starting do not snap the hand.
    this.walk += (walking - this.walk) * Math.min(1, dt * 10)
    this.bob += dt * this.walk * 9
    this.swing = Math.min(1, this.swing + dt / SWING_SECONDS)
    this.equip = Math.min(1, this.equip + dt / EQUIP_SECONDS)
    this.shieldUp += ((shield ? 1 : 0) - this.shieldUp) * Math.min(1, dt * 14)
    this.impact = Math.min(1, this.impact + dt / IMPACT_SECONDS)
    this.swayX += (swayX - this.swayX) * Math.min(1, dt * 14)
    this.swayY += (swayY - this.swayY) * Math.min(1, dt * 14)

    // The swing: an arc that chops down and across toward the crosshair and
    // returns, fast out and eased back (sin of p² and of √p).
    const p = this.swing
    const chop = p < 1 ? Math.sin(Math.sqrt(p) * Math.PI) : 0
    const sweep = p < 1 ? Math.sin(p * p * Math.PI) : 0
    const lift = p < 1 ? Math.sin(Math.sqrt(p) * Math.PI * 2) : 0
    const arc = p < 1 ? Math.sin(Math.sqrt(p) * Math.PI) : 0
    const punch = this.impact < 1 ? Math.sin(this.impact * Math.PI) : 0
    const bobX = Math.sin(this.bob) * 0.025 * this.walk
    const bobY = -Math.abs(Math.cos(this.bob)) * 0.03 * this.walk
    const dip = (1 - easeOut(this.equip)) * 0.45
    const sh = this.shieldUp
    const nibble = eating ? Math.sin(performance.now() / 60) * 0.03 : 0

    this.hand.position.set(
      0.37 + bobX - chop * 0.24 - sh * 0.24 - draw * 0.15 - this.swayX * 0.05 + punch * 0.02,
      -0.34 + bobY + lift * 0.1 - dip + sh * 0.08 + draw * 0.06 + nibble + this.swayY * 0.03 - punch * 0.03,
      -0.8 - sweep * 0.16 + draw * 0.18 + punch * 0.08,
    )
    this.hand.rotation.set(
      0.15 - chop * 0.95 + punch * 0.24 - this.swayY * 0.12,
      0.2 + sweep * 0.55 + sh * 0.6 + draw * 0.5 + this.swayX * 0.15,
      -chop * 0.22 + draw * 0.5,
    )

    this.slash.visible = arc > 0.015
    if (arc > 0.015) {
      this.slashMat.opacity = arc * 0.32
      this.slash.rotation.z = -2.5 + p * 3.1
      this.slash.position.set(0.2 - p * 0.55, -0.12 + p * 0.2, -0.88)
      this.slash.scale.setScalar(0.9 + p * 0.35)
    }

    if (this.heldGlint && this.glintBase > 0) {
      const pulse = 0.85 + Math.sin(performance.now() / 1000 * 3.4) * 0.2
      this.heldGlint.emissive.copy(this.glintColor).multiplyScalar(this.glintBase * pulse)
    }
  }
}

const SWING_SECONDS = 0.28
const EQUIP_SECONDS = 0.18
const IMPACT_SECONDS = 0.16

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t)
}
