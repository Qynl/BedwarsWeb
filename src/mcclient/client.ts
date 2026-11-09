import {
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three'
import { blockColour, ChunkStore, isOpaqueBlock } from './world'
import {
  chat,
  clientSettings,
  concat,
  handshake,
  keepAlive,
  loginStart,
  parseChat,
  parseChunk,
  parseBlockChange,
  parseChunkBulk,
  parsePosition,
  positionLook,
  readPacket,
  Reader,
  S2C,
  VERSION_NAME,
} from './protocol'
import { openTunnel, type Tunnel } from './proxy'

export interface ClientEvents {
  status(text: string, kind?: 'info' | 'ok' | 'error'): void
  chat(line: string): void
  joined(): void
  disconnected(reason: string): void
  moved(x: number, y: number, z: number): void
}

const FACES: { normal: [number, number, number]; corners: [number, number, number][]; shade: number }[] = [
  { normal: [1, 0, 0], corners: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]], shade: 0.82 },
  { normal: [-1, 0, 0], corners: [[0, 0, 1], [0, 0, 0], [0, 1, 0], [0, 1, 1]], shade: 0.82 },
  { normal: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], shade: 1 },
  { normal: [0, -1, 0], corners: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]], shade: 0.58 },
  { normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.72 },
  { normal: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.72 },
]

/**
 * A deliberately small real client: it logs in as an offline player, keeps the
 * connection alive, reads chunks and renders their visible block faces. It is
 * a viewer with fly controls, not a full survival client yet.
 */
export class RealClient {
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(75, 1, 0.08, 512)
  private readonly renderer: WebGLRenderer
  private readonly material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide })
  private readonly chunks = new ChunkStore()
  private readonly meshes = new Map<string, Mesh>()
  private readonly pending = new Set<string>()
  private readonly keys = new Set<string>()

  private tunnel: Tunnel | null = null
  private buffer: Uint8Array = new Uint8Array(0)
  private threshold = -1
  private state: 'idle' | 'login' | 'play' | 'dead' = 'idle'
  private readonly position = { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 }
  private lastSend = 0
  private lastMove = 0
  private yaw = 0
  private pitch = 0
  private frame = 0
  private disposed = false

  constructor(private readonly canvas: HTMLCanvasElement, private readonly events: ClientEvents) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.scene.background = new Color(0x8fc8f0)
    this.scene.fog = new Fog(0x8fc8f0, 90, 260)
    this.scene.add(new HemisphereLight(0xffffff, 0x53606f, 1.15))
    const sun = new DirectionalLight(0xffffff, 1.35)
    sun.position.set(0.4, 1, 0.2)
    this.scene.add(sun)

    this.resize()
    window.addEventListener('resize', this.resize)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    document.addEventListener('pointerlockchange', this.onLockChange)
    document.addEventListener('mousemove', this.onMouseMove)
    canvas.addEventListener('click', this.lock)
    requestAnimationFrame(this.animate)
  }

  async connect(host: string, port: number, name: string, proxy?: string): Promise<void> {
    this.disconnect()
    this.state = 'login'
    this.threshold = -1
    this.buffer = new Uint8Array(0)
    this.resetWorld()
    this.events.status('Opening the WebSocket proxy…')
    try {
      const tunnel = await openTunnel(host, port, proxy)
      if (this.disposed) { tunnel.close(); return }
      this.tunnel = tunnel
      tunnel.setHandlers(
        (bytes) => { if (this.tunnel === tunnel) this.receive(bytes) },
        (reason) => { if (this.tunnel === tunnel) this.fail(reason) },
      )
      if (this.tunnel !== tunnel) return
      tunnel.send(handshake(host, port))
      tunnel.send(loginStart(name))
      this.events.status(`Logging in as ${name}…`)
    } catch (error) {
      this.fail((error as Error).message)
    }
  }

  private resetWorld(): void {
    for (const mesh of this.meshes.values()) {
      this.scene.remove(mesh)
      mesh.geometry.dispose()
    }
    this.meshes.clear()
    this.pending.clear()
    this.chunks.clear()
    this.position.x = 0
    this.position.y = 64
    this.position.z = 0
    this.yaw = 0
    this.pitch = 0
  }

  disconnect(): void {
    this.state = 'idle'
    const tunnel = this.tunnel
    this.tunnel = null
    tunnel?.close()
    this.keys.clear()
    if (document.pointerLockElement === this.canvas) document.exitPointerLock()
    this.events.status('Disconnected.')
  }

  dispose(): void {
    this.disposed = true
    this.disconnect()
    window.removeEventListener('resize', this.resize)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    document.removeEventListener('pointerlockchange', this.onLockChange)
    document.removeEventListener('mousemove', this.onMouseMove)
    this.canvas.removeEventListener('click', this.lock)
    for (const mesh of this.meshes.values()) { mesh.geometry.dispose() }
    this.renderer.dispose()
  }

  say(message: string): void {
    if (!this.tunnel || this.state !== 'play' || !message.trim()) return
    this.tunnel.send(chat(message.trim(), this.threshold))
  }

  private receive(bytes: Uint8Array): void {
    this.buffer = concat(this.buffer, bytes)
    for (;;) {
      let next
      try {
        next = readPacket(this.buffer, this.threshold)
      } catch (error) {
        this.fail(`Bad packet from the server: ${(error as Error).message}`)
        return
      }
      if (!next) break
      this.buffer = next.rest
      try {
        this.handle(next.packet.id, next.packet.data)
      } catch (error) {
        this.fail(`Could not read packet 0x${next.packet.id.toString(16)}: ${(error as Error).message}`)
        return
      }
    }
  }

  private handle(id: number, data: Uint8Array): void {
    if (this.state === 'login') {
      if (id === 0x03) {
        this.threshold = new Reader(data).varint()
        this.events.status(`Server compression: ${this.threshold} bytes.`)
        return
      }
      if (id === 0x01) {
        this.fail('This server is online-mode. A browser client can only join offline-mode servers.')
        return
      }
      if (id === 0x02) {
        const success = new Reader(data)
        success.string() // UUID
        const username = success.string()
        this.state = 'play'
        this.events.status(`Joined as ${username} — ${VERSION_NAME}.`, 'ok')
        this.tunnel?.send(clientSettings(10, this.threshold))
        this.events.joined()
        return
      }
      if (id === 0x00) {
        this.fail(plainText(parseChat(data)))
        return
      }
      return
    }
    if (this.state !== 'play') return

    switch (id) {
      case S2C.keepAlive:
        this.tunnel?.send(keepAlive(new Reader(data).varint(), this.threshold))
        break
      case S2C.joinGame:
        this.events.status('World accepted; waiting for chunks…', 'ok')
        break
      case S2C.chat:
        this.events.chat(plainText(parseChat(data)))
        break
      case S2C.position: {
        const p = parsePosition(data)
        this.position.x = p.x
        this.position.y = p.y
        this.position.z = p.z
        this.yaw = p.yaw * Math.PI / 180
        this.pitch = p.pitch * Math.PI / 180
        break
      }
      case S2C.chunk: {
        const column = parseChunk(data)
        this.addChunk(column)
        break
      }
      case 0x26: {
        for (const column of parseChunkBulk(data)) this.addChunk(column)
        break
      }
      case S2C.blockChange: {
        const change = parseBlockChange(data)
        if (this.chunks.setBlock(change.x, change.y, change.z, change.id)) {
          const cx = Math.floor(change.x / 16)
          const cz = Math.floor(change.z / 16)
          this.pending.add(`${cx},${cz}`)
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (this.chunks.has(cx + dx, cz + dz)) this.pending.add(`${cx + dx},${cz + dz}`)
          }
        }
        break
      }
      case S2C.kick:
        this.fail(plainText(parseChat(data)))
        break
    }
  }

  private fail(reason: string): void {
    if (this.state === 'dead') return
    this.state = 'dead'
    const tunnel = this.tunnel
    this.tunnel = null
    tunnel?.close()
    this.events.status(reason, 'error')
    this.events.disconnected(reason)
  }

  private addChunk(column: ReturnType<typeof parseChunk>): void {
    this.chunks.set(column)
    this.pending.add(`${column.x},${column.z}`)
    // The new column exposes faces at its edges, so rebuild its four neighbours too.
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = column.x + dx
      const z = column.z + dz
      if (this.chunks.has(x, z)) this.pending.add(`${x},${z}`)
    }
  }

  private buildChunk(cx: number, cz: number): void {
    const chunk = this.chunks.get(cx, cz)
    if (!chunk) return
    const positions: number[] = []
    const colours: number[] = []
    const normals: number[] = []
    const indices: number[] = []
    for (let y = 0; y < 256; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const id = chunk.blocks[(y << 8) | (z << 4) | x]
          if (id === 0) continue
          const wx = cx * 16 + x
          const wz = cz * 16 + z
          const colour = blockColour(id)
          for (const face of FACES) {
            const [nx, ny, nz] = face.normal
            if (isOpaqueBlock(this.chunks.block(wx + nx, y + ny, wz + nz))) continue
            const base = positions.length / 3
            for (const [vx, vy, vz] of face.corners) {
              positions.push(x + vx, y + vy, z + vz)
              normals.push(nx, ny, nz)
              colours.push(colour[0] * face.shade, colour[1] * face.shade, colour[2] * face.shade)
            }
            indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
          }
        }
      }
    }
    const key = `${cx},${cz}`
    const old = this.meshes.get(key)
    if (old) { this.scene.remove(old); old.geometry.dispose(); this.meshes.delete(key) }
    if (indices.length === 0) return
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
    geometry.setAttribute('color', new Float32BufferAttribute(colours, 3))
    geometry.setIndex(indices)
    geometry.computeBoundingSphere()
    const mesh = new Mesh(geometry, this.material)
    mesh.position.set(cx * 16, 0, cz * 16)
    this.scene.add(mesh)
    this.meshes.set(key, mesh)
  }

  private animate = (time: number): void => {
    if (this.disposed) return
    this.frame++
    const dt = Math.min(0.1, (time - (this.lastMove || time)) / 1000)
    this.lastMove = time
    for (let i = 0; i < 2; i++) {
      const key = this.pending.values().next().value as string | undefined
      if (!key) break
      this.pending.delete(key)
      const [cx, cz] = key.split(',').map(Number)
      this.buildChunk(cx, cz)
    }

    if (document.pointerLockElement === this.canvas && this.state === 'play') this.move(dt)
    this.camera.position.set(this.position.x, this.position.y + 1.62, this.position.z)
    const cp = Math.cos(this.pitch)
    this.camera.lookAt(
      this.camera.position.x - Math.sin(this.yaw) * cp,
      this.camera.position.y + Math.sin(this.pitch),
      this.camera.position.z + Math.cos(this.yaw) * cp,
    )
    this.renderer.render(this.scene, this.camera)
    if (this.frame % 12 === 0) this.events.moved(this.position.x, this.position.y, this.position.z)
    requestAnimationFrame(this.animate)
  }

  private move(dt: number): void {
    const speed = this.keys.has('ShiftLeft') ? 4 : 12
    const forward = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'))
    const strafe = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'))
    const vertical = Number(this.keys.has('Space')) - Number(this.keys.has('ControlLeft'))
    if (forward || strafe || vertical) {
      const length = Math.hypot(forward, strafe) || 1
      const sin = Math.sin(this.yaw)
      const cos = Math.cos(this.yaw)
      this.position.x += ((-sin * forward / length) + (cos * strafe / length)) * speed * dt
      this.position.z += ((cos * forward / length) + (sin * strafe / length)) * speed * dt
      this.position.y += vertical * speed * dt
      this.sendPosition()
    } else if (performance.now() - this.lastSend > 1000) {
      this.sendPosition()
    }
  }

  private sendPosition(): void {
    if (!this.tunnel || this.state !== 'play') return
    const now = performance.now()
    if (now - this.lastSend < 50) return
    this.lastSend = now
    this.tunnel.send(positionLook(this.position.x, this.position.y, this.position.z, this.yaw * 180 / Math.PI, this.pitch * 180 / Math.PI, false, this.threshold))
  }

  private resize = (): void => {
    const width = window.innerWidth
    const height = window.innerHeight
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  private lock = (): void => {
    if (this.state === 'play') void this.canvas.requestPointerLock()
  }

  private onLockChange = (): void => {
    if (document.pointerLockElement !== this.canvas) this.keys.clear()
  }

  private onMouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas) return
    this.yaw -= event.movementX * 0.0024
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - event.movementY * 0.0024))
    this.sendPosition()
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement) return
    if (event.code === 'Escape') { if (document.pointerLockElement === this.canvas) document.exitPointerLock(); return }
    this.keys.add(event.code)
    if (event.code === 'Space') event.preventDefault()
  }

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code)
  }
}

/** 1.8 chat is JSON; flatten the common text/extra shape into one line. */
export function plainText(raw: string): string {
  try {
    const value = JSON.parse(raw) as unknown
    return flatten(value)
  } catch {
    return raw
  }
}

function flatten(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const object = value as { text?: unknown; extra?: unknown; translate?: unknown; with?: unknown }
  let text = typeof object.text === 'string' ? object.text : ''
  if (typeof object.translate === 'string' && !text) text = object.translate
  if (Array.isArray(object.with)) text += object.with.map(flatten).join('')
  if (Array.isArray(object.extra)) text += object.extra.map(flatten).join('')
  return text
}
