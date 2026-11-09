import { BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, SphereGeometry, type ShaderMaterial } from 'three'
import { hash2 } from '../random'
import { createCloudMaterial, createSkyMaterial, type Environment } from './shaders'

/** Sky dome that follows the camera, and a drifting layer of blocky clouds. */
export function createSky(env: Environment, cloudY: number, center: [number, number]) {
  const group = new Group()
  const dome = new Mesh(new SphereGeometry(400, 32, 16), createSkyMaterial(env))
  dome.renderOrder = -1
  dome.frustumCulled = false
  group.add(dome)

  const clouds = new Mesh(cloudGeometry(), createCloudMaterial(env))
  clouds.position.set(center[0] - 192, cloudY, center[1] - 192)
  clouds.renderOrder = 2
  const root = new Group()
  root.add(group, clouds)
  const domeMaterial = dome.material as ShaderMaterial
  const cloudMaterial = clouds.material as ShaderMaterial
  const base = { top: env.skyTop.clone(), middle: env.skyMiddle.clone(), bottom: env.skyBottom.clone() }
  return {
    root,
    cloudMaterial,
    /** Recolours the dome and clouds for arena weather. Null restores the clear sky. */
    setWeather(kind: string | null) {
      const t = kind === null ? 0 : kind === 'meteor' ? 0.8 : 1
      const top = kind === 'meteor' ? new Color('#3a2024') : new Color('#1b2b3f')
      const middle = kind === 'meteor' ? new Color('#8a4a3a') : new Color('#55677d')
      const bottom = kind === 'meteor' ? new Color('#201418') : new Color('#111a26')
      domeMaterial.uniforms.uSkyTop.value = base.top.clone().lerp(top, t)
      domeMaterial.uniforms.uSkyMiddle.value = base.middle.clone().lerp(middle, t)
      domeMaterial.uniforms.uSkyBottom.value = base.bottom.clone().lerp(bottom, t)
      cloudMaterial.uniforms.uCloudColor.value = new Color(1, 1, 1).lerp(new Color(kind === 'meteor' ? '#5a3a3a' : '#7c8ba1'), t)
      cloudMaterial.uniforms.uCloudAlpha.value = 0.82 + t * 0.16
    },
    update(cameraX: number, cameraY: number, cameraZ: number, seconds: number) {
      dome.position.set(cameraX, cameraY, cameraZ)
      clouds.position.x = center[0] - 192 + ((seconds * 0.6) % 48)
    },
  }
}

/** Cloud cells on a 2D noise threshold, culled like Voxelize's cloud mesher: only faces against empty cells. */
function cloudGeometry(): BufferGeometry {
  const N = 48
  const S = 8
  const H = 3
  const on = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= N || z >= N) return false
    const n = hash2(x >> 1, z >> 1, 9) * 0.6 + hash2(x, z, 3) * 0.4
    return n > 0.68
  }
  const pos: number[] = []
  const nor: number[] = []
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[]) => {
    pos.push(...a, ...b, ...c, ...c, ...b, ...d)
    for (let i = 0; i < 6; i++) nor.push(...n)
  }
  for (let x = 0; x < N; x++)
    for (let z = 0; z < N; z++) {
      if (!on(x, z)) continue
      const x0 = x * S
      const x1 = x0 + S
      const z0 = z * S
      const z1 = z0 + S
      quad([x0, H, z0], [x0, H, z1], [x1, H, z0], [x1, H, z1], [0, 1, 0])
      quad([x1, 0, z0], [x1, 0, z1], [x0, 0, z0], [x0, 0, z1], [0, -1, 0])
      if (!on(x + 1, z)) quad([x1, H, z1], [x1, 0, z1], [x1, H, z0], [x1, 0, z0], [1, 0, 0])
      if (!on(x - 1, z)) quad([x0, H, z0], [x0, 0, z0], [x0, H, z1], [x0, 0, z1], [-1, 0, 0])
      if (!on(x, z + 1)) quad([x0, H, z1], [x0, 0, z1], [x1, H, z1], [x1, 0, z1], [0, 0, 1])
      if (!on(x, z - 1)) quad([x1, H, z0], [x1, 0, z0], [x0, H, z0], [x0, 0, z0], [0, 0, -1])
    }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3))
  return g
}

