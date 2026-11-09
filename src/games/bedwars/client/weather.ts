import { BufferAttribute, BufferGeometry, Color, Fog, Group, LineBasicMaterial, LineSegments, type Scene, type WebGLRenderer } from 'three'
import type { WeatherKind } from '../protocol'

interface Drop {
  x: number
  y: number
  z: number
  speed: number
  length: number
}

const DROPS = 700
const RANGE = 34
const TOP = 20
const BOTTOM = -12

/** Storm rain and the sky/fog tint for each arena weather. Drawn locally; the room only sends the kind. */
export class WeatherFX {
  readonly group = new Group()
  private rain: LineSegments
  private drops: Drop[] = []
  private kind: WeatherKind | null = null
  private baseFog = new Color()
  private baseSky: Color | null = null

  constructor() {
    const geometry = new BufferGeometry()
    const positions = new Float32Array(DROPS * 6)
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    this.rain = new LineSegments(geometry, new LineBasicMaterial({ color: '#b9d4ff', transparent: true, opacity: 0.42, depthWrite: false }))
    this.rain.frustumCulled = false
    this.group.add(this.rain)
    this.group.visible = false
    for (let i = 0; i < DROPS; i++)
      this.drops.push({
        x: (Math.random() - 0.5) * RANGE * 2,
        y: BOTTOM + Math.random() * (TOP - BOTTOM),
        z: (Math.random() - 0.5) * RANGE * 2,
        speed: 18 + Math.random() * 10,
        length: 0.55 + Math.random() * 0.8,
      })
  }

  /** `sky` is the sky dome handle; `baseSky` is the clear-weather clear colour to restore. */
  set(kind: WeatherKind | null, scene: Scene, renderer: WebGLRenderer, sky: { setWeather(kind: WeatherKind | null): void } | null, baseSky: Color): void {
    if (this.baseSky === null) {
      this.baseSky = baseSky.clone()
      this.baseFog.copy((scene.fog as Fog).color)
    }
    this.kind = kind
    this.group.visible = kind === 'storm'
    const fog = scene.fog as Fog
    if (kind === 'storm') {
      fog.color.copy(this.baseFog).lerp(new Color('#3c4c60'), 0.72)
      renderer.setClearColor(new Color(this.baseSky).lerp(new Color('#2c3b4d'), 0.75))
    } else if (kind === 'meteor') {
      fog.color.copy(this.baseFog).lerp(new Color('#5a3030'), 0.66)
      renderer.setClearColor(new Color(this.baseSky).lerp(new Color('#61322e'), 0.62))
    } else {
      fog.color.copy(this.baseFog)
      renderer.setClearColor(this.baseSky)
    }
    sky?.setWeather(kind)
  }

  /** Rain follows the camera and wraps, so the storm is everywhere without covering the whole arena. */
  frame(dt: number, x: number, y: number, z: number): void {
    if (this.kind !== 'storm') return
    this.group.position.set(x, y, z)
    const position = this.rain.geometry.getAttribute('position') as BufferAttribute
    const array = position.array as Float32Array
    this.drops.forEach((drop, i) => {
      drop.y -= drop.speed * dt
      if (drop.y < BOTTOM) {
        drop.y = TOP
        drop.x = (Math.random() - 0.5) * RANGE * 2
        drop.z = (Math.random() - 0.5) * RANGE * 2
      }
      const o = i * 6
      array[o] = drop.x
      array[o + 1] = drop.y
      array[o + 2] = drop.z
      array[o + 3] = drop.x - 0.06
      array[o + 4] = drop.y - drop.length
      array[o + 5] = drop.z
    })
    position.needsUpdate = true
  }

  dispose(): void {
    this.rain.geometry.dispose()
    ;(this.rain.material as LineBasicMaterial).dispose()
  }
}
