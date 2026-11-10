import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Fog,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three'
import {
  blockColour,
  ChunkStore,
  HOTBAR_BLOCKS,
  isOpaqueBlock,
  isSolidBlock,
  PLAYER_HEIGHT,
  playerCollides,
  raycastBlock,
  type HotbarItem,
  type TargetBlock,
} from './world'
import {
  blockDig,
  blockPlace,
  chat,
  clientSettings,
  concat,
  handshake,
  heldItemSlot,
  keepAlive,
  loginStart,
  parseBlockChange,
  parseChat,
  parseChunk,
  parseChunkBulk,
  parseEntityDestroy,
  parseEntityLook,
  parseEntityMove,
  parseEntityMoveLook,
  parseEntityTeleport,
  parseHealth,
  parseMultiBlockChange,
  parsePosition,
  parseSpawnMob,
  parseSpawnObject,
  parseSpawnPlayer,
  positionLook,
  readPacket,
  Reader,
  S2C,
  VERSION_NAME,
  type SpawnedEntity,
} from './protocol'
import { openTunnel, type ProxyChoice, type Tunnel } from './proxy'

export interface ClientEvents {
  status(text: string, kind?: 'info' | 'ok' | 'error'): void
  chat(line: string): void
  joined(): void
  disconnected(reason: string): void
  moved(x: number, y: number, z: number): void
  selected(index: number, item: HotbarItem): void
  stats(health: number, food: number): void
}

interface EntityView {
  id: number
  kind: SpawnedEntity['kind']
  type: number
  mesh: Mesh
  height: number
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
}

const FACES: { normal: [number, number, number]; corners: [number, number, number][]; shade: number }[] = [
  { normal: [1, 0, 0], corners: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]], shade: 0.82 },
  { normal: [-1, 0, 0], corners: [[0, 0, 1], [0, 0, 0], [0, 1, 0], [0, 1, 1]], shade: 0.82 },
  { normal: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], shade: 1 },
  { normal: [0, -1, 0], corners: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]], shade: 0.58 },
  { normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.72 },
  { normal: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.72 },
]

const EYE_HEIGHT = 1.62
const GRAVITY = 32
const JUMP_VELOCITY = 8.6
const WALK_SPEED = 4.3
const SPRINT_SPEED = 5.8
const SNEAK_SPEED = 1.35
const FLY_SPEED = 11
const FLY_FAST = 22
const SEND_INTERVAL = 50

const MOB_COLOURS: Record<number, number> = {
  50: 0x52c46a, 51: 0xe35d3f, 52: 0x86949e, 54: 0xa87545, 55: 0x8b5a3c, 56: 0x8e6dcc,
  57: 0x9b59b6, 58: 0x7f5539, 59: 0xc8b458, 60: 0xb0a58f, 61: 0xd8a45b, 62: 0xf0c94c,
  65: 0x9b8f73, 66: 0x9a7b57, 67: 0xc9a227, 90: 0xd65a4f, 92: 0xf3d6d0, 93: 0xf5d76e,
  94: 0x4aa3df, 95: 0x7f8c8d, 96: 0xb08d57, 98: 0x8e7cc3, 99: 0xbcae8d, 100: 0xcd6155,
  120: 0x6a5acd,
}

/**
 * Our own 1.8.9 client. It logs in offline, streams chunks, walks with
 * collision (or flies with F), breaks/places blocks with the hotbar, renders
 * other players/mobs as simple coloured bodies, and keeps the connection alive.
 * It is not a vanilla client: no Mojang assets, inventory containers or skins.
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
  private readonly entities = new Map<number, EntityView>()
  private readonly highlight: LineSegments

  private tunnel: Tunnel | null = null
  private buffer: Uint8Array = new Uint8Array(0)
  private threshold = -1
  private state: 'idle' | 'login' | 'play' | 'dead' = 'idle'
  private readonly position = { x: 0, y: 64, z: 0 }
  private readonly velocity = { x: 0, y: 0, z: 0 }
  private lastSend = 0
  private chunkTimer: ReturnType<typeof setTimeout> | null = null
  private lastMove = 0
  private yaw = 0
  private pitch = 0
  private frame = 0
  private disposed = false
  private onGround = false
  private flying = false
  private entityId = 0
  private health = 20
  private food = 20
  private selected = 0
  private target: TargetBlock | null = null
  private audio: AudioContext | null = null

  constructor(private readonly canvas: HTMLCanvasElement, private readonly events: ClientEvents) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.scene.background = new Color(0x8fc8f0)
    this.scene.fog = new Fog(0x8fc8f0, 90, 260)
    this.scene.add(new HemisphereLight(0xffffff, 0x53606f, 1.15))
    const sun = new DirectionalLight(0xffffff, 1.35)
    sun.position.set(0.4, 1, 0.2)
    this.scene.add(sun)

    this.highlight = new LineSegments(
      new EdgesGeometry(new BoxGeometry(1.003, 1.003, 1.003)),
      new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
    )
    this.highlight.visible = false
    this.scene.add(this.highlight)

    this.resize()
    window.addEventListener('resize', this.resize)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    document.addEventListener('pointerlockchange', this.onLockChange)
    document.addEventListener('mousemove', this.onMouseMove)
    canvas.addEventListener('click', this.lock)
    canvas.addEventListener('mousedown', this.onMouseDown)
    canvas.addEventListener('contextmenu', this.onContextMenu)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    requestAnimationFrame(this.animate)
  }

  async connect(host: string, port: number, name: string, proxy?: string | ProxyChoice): Promise<void> {
    this.disconnect()
    this.state = 'login'
    this.threshold = -1
    this.buffer = new Uint8Array(0)
    this.entityId = 0
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
    for (const id of [...this.entities.keys()]) this.removeEntity(id)
    this.highlight.visible = false
    this.target = null
    if (this.chunkTimer) { clearTimeout(this.chunkTimer); this.chunkTimer = null }
    this.position.x = 0
    this.position.y = 64
    this.position.z = 0
    this.velocity.x = 0
    this.velocity.y = 0
    this.velocity.z = 0
    this.yaw = 0
    this.pitch = 0
    this.onGround = false
    this.flying = false
    this.health = 20
    this.food = 20
    this.events.stats(this.health, this.food)
  }

  disconnect(): void {
    this.state = 'idle'
    const tunnel = this.tunnel
    this.tunnel = null
    tunnel?.close()
    this.keys.clear()
    this.velocity.x = 0
    this.velocity.y = 0
    this.velocity.z = 0
    if (document.pointerLockElement === this.canvas) document.exitPointerLock()
    this.events.status('Disconnected.')
  }

  dispose(): void {
    this.disposed = true
    if (this.chunkTimer) { clearTimeout(this.chunkTimer); this.chunkTimer = null }
    this.disconnect()
    window.removeEventListener('resize', this.resize)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    document.removeEventListener('pointerlockchange', this.onLockChange)
    document.removeEventListener('mousemove', this.onMouseMove)
    this.canvas.removeEventListener('click', this.lock)
    this.canvas.removeEventListener('mousedown', this.onMouseDown)
    this.canvas.removeEventListener('contextmenu', this.onContextMenu)
    this.canvas.removeEventListener('wheel', this.onWheel)
    for (const mesh of this.meshes.values()) mesh.geometry.dispose()
    for (const id of [...this.entities.keys()]) this.removeEntity(id)
    this.highlight.geometry.dispose()
    ;(this.highlight.material as LineBasicMaterial).dispose()
    this.material.dispose()
    this.renderer.dispose()
    void this.audio?.close().catch(() => {})
  }

  say(message: string): void {
    if (!this.tunnel || this.state !== 'play' || !message.trim()) return
    this.tunnel.send(chat(message.trim(), this.threshold))
  }

  select(index: number): void {
    const next = ((index % HOTBAR_BLOCKS.length) + HOTBAR_BLOCKS.length) % HOTBAR_BLOCKS.length
    if (next === this.selected) return
    this.selected = next
    if (this.tunnel && this.state === 'play') this.tunnel.send(heldItemSlot(next, this.threshold))
    this.events.selected(next, HOTBAR_BLOCKS[next])
  }

  private fail(reason: string): void {
    if (this.state === 'dead') return
    this.state = 'dead'
    const tunnel = this.tunnel
    this.tunnel = null
    tunnel?.close()
    this.keys.clear()
    this.events.status(reason, 'error')
    this.events.disconnected(reason)
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
        success.string()
        const username = success.string()
        this.state = 'play'
        this.events.status(`Joined as ${username} — ${VERSION_NAME}.`, 'ok')
        this.tunnel?.send(clientSettings(10, this.threshold))
        if (this.tunnel) this.tunnel.send(heldItemSlot(this.selected, this.threshold))
        this.events.selected(this.selected, HOTBAR_BLOCKS[this.selected])
        this.events.stats(this.health, this.food)
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
        this.entityId = new Reader(data).i32()
        this.events.status('World accepted; waiting for terrain…', 'ok')
        break
      case S2C.chat:
        this.events.chat(plainText(parseChat(data)))
        break
      case S2C.health: {
        const status = parseHealth(data)
        this.health = status.health
        this.food = status.food
        this.events.stats(this.health, this.food)
        if (status.health <= 0) this.events.status('You died — waiting for respawn…', 'error')
        break
      }
      case S2C.respawn:
        this.resetWorld()
        this.state = 'play'
        this.events.status('Respawned; waiting for terrain…', 'ok')
        break
      case S2C.position: {
        const p = parsePosition(data)
        this.position.x = (p.flags & 0x01) !== 0 ? this.position.x + p.x : p.x
        this.position.y = (p.flags & 0x02) !== 0 ? this.position.y + p.y : p.y
        this.position.z = (p.flags & 0x04) !== 0 ? this.position.z + p.z : p.z
        const toRad = Math.PI / 180
        const yaw = (p.flags & 0x08) !== 0 ? this.yaw / toRad + p.yaw : p.yaw
        const pitch = (p.flags & 0x10) !== 0 ? -this.pitch / toRad + p.pitch : p.pitch
        this.yaw = yaw * toRad
        this.pitch = -pitch * toRad
        this.velocity.x = 0
        this.velocity.y = 0
        this.velocity.z = 0
        this.onGround = false
        this.lastSend = 0
        break
      }
      case S2C.chunk:
        this.addChunk(parseChunk(data))
        break
      case S2C.chunkBulk:
        for (const column of parseChunkBulk(data)) this.addChunk(column)
        break
      case S2C.multiBlockChange:
        for (const change of parseMultiBlockChange(data)) this.applyBlockChange(change.x, change.y, change.z, change.id)
        break
      case S2C.blockChange: {
        const change = parseBlockChange(data)
        this.applyBlockChange(change.x, change.y, change.z, change.id)
        break
      }
      case S2C.spawnPlayer:
        this.spawnEntity(parseSpawnPlayer(data))
        break
      case S2C.spawnMob:
        this.spawnEntity(parseSpawnMob(data))
        break
      case S2C.spawnObject:
        this.spawnEntity(parseSpawnObject(data))
        break
      case S2C.entityMove: {
        const move = parseEntityMove(data)
        const entity = this.entities.get(move.id)
        if (entity) {
          entity.x += move.dx
          entity.y += move.dy
          entity.z += move.dz
          entity.mesh.position.set(entity.x, entity.y + entity.height / 2, entity.z)
        }
        break
      }
      case S2C.entityLook: {
        const look = parseEntityLook(data)
        const entity = this.entities.get(look.id)
        if (entity) { entity.yaw = look.yaw; entity.pitch = look.pitch; entity.mesh.rotation.y = -look.yaw }
        break
      }
      case S2C.entityMoveLook: {
        const move = parseEntityMoveLook(data)
        const entity = this.entities.get(move.id)
        if (entity) {
          entity.x += move.dx
          entity.y += move.dy
          entity.z += move.dz
          entity.yaw = move.yaw
          entity.pitch = move.pitch
          entity.mesh.position.set(entity.x, entity.y + entity.height / 2, entity.z)
          entity.mesh.rotation.y = -move.yaw
        }
        break
      }
      case S2C.entityTeleport: {
        const teleport = parseEntityTeleport(data)
        const entity = this.entities.get(teleport.id)
        if (entity) {
          entity.x = teleport.x
          entity.y = teleport.y
          entity.z = teleport.z
          entity.yaw = teleport.yaw
          entity.pitch = teleport.pitch
          entity.mesh.position.set(entity.x, entity.y + entity.height / 2, entity.z)
          entity.mesh.rotation.y = -teleport.yaw
        }
        break
      }
      case S2C.entityDestroy:
        for (const id of parseEntityDestroy(data)) this.removeEntity(id)
        break
      case S2C.kick:
        this.fail(plainText(parseChat(data)))
        break
    }
  }

  private applyBlockChange(x: number, y: number, z: number, id: number): void {
    if (!this.chunks.setBlock(x, y, z, id)) return
    const cx = Math.floor(x / 16)
    const cz = Math.floor(z / 16)
    this.pending.add(`${cx},${cz}`)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (this.chunks.has(cx + dx, cz + dz)) this.pending.add(`${cx + dx},${cz + dz}`)
    }
  }

  private addChunk(column: ReturnType<typeof parseChunk>): void {
    this.chunks.set(column)
    this.pending.add(`${column.x},${column.z}`)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = column.x + dx
      const z = column.z + dz
      if (this.chunks.has(x, z)) this.pending.add(`${x},${z}`)
    }
    if (this.chunkTimer) clearTimeout(this.chunkTimer)
    this.chunkTimer = setTimeout(() => {
      this.chunkTimer = null
      if (this.state === 'play') this.events.status(`Terrain: ${this.chunks.all().length} chunks.`, 'ok')
    }, 400)
  }

  private spawnEntity(spawn: SpawnedEntity): void {
    if (spawn.id === this.entityId) return
    if (this.entities.has(spawn.id)) this.removeEntity(spawn.id)
    const [width, height, depth, colour] = this.entityShape(spawn)
    const mesh = new Mesh(new BoxGeometry(width, height, depth), new MeshLambertMaterial({ color: colour }))
    mesh.position.set(spawn.x, spawn.y + height / 2, spawn.z)
    mesh.rotation.y = -spawn.yaw
    this.scene.add(mesh)
    this.entities.set(spawn.id, { id: spawn.id, kind: spawn.kind, type: spawn.type, mesh, height, x: spawn.x, y: spawn.y, z: spawn.z, yaw: spawn.yaw, pitch: spawn.pitch })
  }

  private entityShape(spawn: SpawnedEntity): [number, number, number, number] {
    if (spawn.kind === 'player') {
      let hash = 0
      for (const char of spawn.uuid ?? String(spawn.id)) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0
      const colour = new Color().setHSL((hash % 360) / 360, 0.5, 0.58).getHex()
      return [0.6, 1.8, 0.6, colour]
    }
    if (spawn.kind === 'mob') return [0.7, 1.1, 0.7, MOB_COLOURS[spawn.type] ?? 0x9c7b5c]
    return [0.35, 0.35, 0.35, spawn.type === 60 ? 0xd6e04f : 0xb0b7bd]
  }

  private removeEntity(id: number): void {
    const entity = this.entities.get(id)
    if (!entity) return
    this.scene.remove(entity.mesh)
    entity.mesh.geometry.dispose()
    ;(entity.mesh.material as MeshLambertMaterial).dispose()
    this.entities.delete(id)
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
    const elapsed = (time - this.lastMove) / 1000
    this.lastMove = time
    const dt = Math.min(0.05, Math.max(0, Number.isFinite(elapsed) ? elapsed : 0))
    for (let i = 0; i < 2; i++) {
      const key = this.pending.values().next().value as string | undefined
      if (!key) break
      this.pending.delete(key)
      const [cx, cz] = key.split(',').map(Number)
      this.buildChunk(cx, cz)
    }

    if (document.pointerLockElement === this.canvas && this.state === 'play') this.move(dt)
    this.camera.position.set(this.position.x, this.position.y + EYE_HEIGHT, this.position.z)
    const cp = Math.cos(this.pitch)
    this.camera.lookAt(
      this.camera.position.x - Math.sin(this.yaw) * cp,
      this.camera.position.y + Math.sin(this.pitch),
      this.camera.position.z + Math.cos(this.yaw) * cp,
    )
    if (this.state === 'play') this.updateTarget()
    this.renderer.render(this.scene, this.camera)
    if (this.frame % 12 === 0) this.events.moved(this.position.x, this.position.y, this.position.z)
    if (this.frame % 240 === 0) this.pruneWorld()
    requestAnimationFrame(this.animate)
  }

  /** Drop terrain far outside the server's view distance; keeps long flights bounded. */
  private pruneWorld(): void {
    const cx = Math.floor(this.position.x / 16)
    const cz = Math.floor(this.position.z / 16)
    for (const chunk of this.chunks.all()) {
      if (Math.hypot(chunk.x - cx, chunk.z - cz) <= 14) continue
      this.chunks.delete(chunk.x, chunk.z)
      const key = `${chunk.x},${chunk.z}`
      const mesh = this.meshes.get(key)
      if (mesh) {
        this.scene.remove(mesh)
        mesh.geometry.dispose()
        this.meshes.delete(key)
      }
      this.pending.delete(key)
    }
  }

  private lookDirection(): [number, number, number] {
    const cp = Math.cos(this.pitch)
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp]
  }

  private updateTarget(): void {
    const eye: [number, number, number] = [this.position.x, this.position.y + EYE_HEIGHT, this.position.z]
    this.target = raycastBlock(this.chunks, eye, this.lookDirection(), 6)
    if (!this.target) {
      this.highlight.visible = false
      return
    }
    this.highlight.visible = true
    this.highlight.position.set(this.target.x + 0.5, this.target.y + 0.5, this.target.z + 0.5)
  }

  private move(dt: number): void {
    if (!this.tunnel || dt <= 0) return
    const forward = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'))
    const strafe = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'))
    const jump = this.keys.has('Space')
    const sprint = this.keys.has(this.flying ? 'ControlLeft' : 'ShiftLeft')
    const sneak = this.keys.has(this.flying ? 'ShiftLeft' : 'ControlLeft')
    const vertical = Number(jump) - Number(sneak)
    const sin = Math.sin(this.yaw)
    const cos = Math.cos(this.yaw)
    let wx = 0
    let wz = 0
    if (this.flying) {
      const length = Math.hypot(forward, strafe) || 1
      const speed = sprint ? FLY_FAST : FLY_SPEED
      wx = ((-sin * forward / length) + (cos * strafe / length)) * speed
      wz = ((cos * forward / length) + (sin * strafe / length)) * speed
      this.velocity.x = wx
      this.velocity.z = wz
      this.velocity.y = vertical * speed
      this.onGround = false
      this.stepMove(this.velocity.x * dt, this.velocity.y * dt, this.velocity.z * dt)
      this.sendPosition()
      return
    }

    const length = Math.hypot(forward, strafe) || 1
    const speed = sneak ? SNEAK_SPEED : sprint ? SPRINT_SPEED : WALK_SPEED
    wx = (-sin * forward / length + cos * strafe / length) * speed
    wz = (cos * forward / length + sin * strafe / length) * speed
    const accel = this.onGround ? 26 : 7
    this.velocity.x = approach(this.velocity.x, wx, accel * dt)
    this.velocity.z = approach(this.velocity.z, wz, accel * dt)
    if (jump && this.onGround) {
      this.velocity.y = JUMP_VELOCITY
      this.onGround = false
      this.playSound('jump')
    }
    this.velocity.y = Math.max(-60, this.velocity.y - GRAVITY * dt)
    this.stepMove(this.velocity.x * dt, this.velocity.y * dt, this.velocity.z * dt)
    const grounded = this.velocity.y <= 0 && playerCollides(this.chunks, this.position.x, this.position.y - 0.06, this.position.z)
    if (grounded && !this.onGround) this.playSound('land')
    this.onGround = grounded
    if (this.onGround) this.velocity.y = 0
    this.sendPosition()
  }

  private stepMove(dx: number, dy: number, dz: number): void {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.2))
    const stuck = playerCollides(this.chunks, this.position.x, this.position.y, this.position.z)
    for (let i = 0; i < steps; i++) {
      if (stuck) {
        this.position.x += dx / steps
        this.position.y += dy / steps
        this.position.z += dz / steps
        continue
      }
      if (dy !== 0) {
        const next = this.position.y + dy / steps
        if (playerCollides(this.chunks, this.position.x, next, this.position.z)) {
          if (dy < 0) this.onGround = true
          this.velocity.y = 0
        } else {
          this.position.y = next
        }
      }
      if (dx !== 0) {
        const next = this.position.x + dx / steps
        if (!playerCollides(this.chunks, next, this.position.y, this.position.z)) this.position.x = next
        else this.velocity.x = 0
      }
      if (dz !== 0) {
        const next = this.position.z + dz / steps
        if (!playerCollides(this.chunks, this.position.x, this.position.y, next)) this.position.z = next
        else this.velocity.z = 0
      }
    }
  }

  private sendPosition(): void {
    if (!this.tunnel || this.state !== 'play') return
    const now = performance.now()
    if (now - this.lastSend < SEND_INTERVAL) return
    this.lastSend = now
    this.tunnel.send(positionLook(
      this.position.x, this.position.y, this.position.z,
      this.yaw * 180 / Math.PI, -this.pitch * 180 / Math.PI,
      this.onGround, this.threshold,
    ))
  }

  private faceIndex(face: [number, number, number]): number {
    if (face[1] > 0) return 1
    if (face[1] < 0) return 0
    if (face[2] > 0) return 3
    if (face[2] < 0) return 2
    if (face[0] > 0) return 5
    return 4
  }

  private breakBlock(): void {
    const target = this.target
    if (!target || !this.tunnel || this.state !== 'play') return
    const face = this.faceIndex(target.face)
    this.tunnel.send(blockDig(0, target.x, target.y, target.z, face, this.threshold))
    this.tunnel.send(blockDig(2, target.x, target.y, target.z, face, this.threshold))
    this.playSound('break')
  }

  private placeBlock(): void {
    const target = this.target
    if (!target || !this.tunnel || this.state !== 'play') return
    if (target.face[0] === 0 && target.face[1] === 0 && target.face[2] === 0) return
    const x = target.x + target.face[0]
    const y = target.y + target.face[1]
    const z = target.z + target.face[2]
    if (y < 0 || y > 255) return
    if (isSolidBlock(this.chunks.block(x, y, z))) return
    if (this.blockHitsPlayer(x, y, z)) return
    const item = HOTBAR_BLOCKS[this.selected].id
    this.tunnel.send(blockPlace(target.x, target.y, target.z, this.faceIndex(target.face), item, this.threshold))
    this.playSound('place')
  }

  private blockHitsPlayer(x: number, y: number, z: number): boolean {
    return x + 1 > this.position.x - 0.3 && x < this.position.x + 0.3
      && y + 1 > this.position.y && y < this.position.y + PLAYER_HEIGHT
      && z + 1 > this.position.z - 0.3 && z < this.position.z + 0.3
  }

  private playSound(kind: 'break' | 'place' | 'jump' | 'land'): void {
    try {
      this.audio ??= new AudioContext()
      const context = this.audio
      if (context.state === 'suspended') void context.resume()
      const osc = context.createOscillator()
      const gain = context.createGain()
      const tone = kind === 'break' ? 150 : kind === 'place' ? 320 : kind === 'jump' ? 460 : 110
      const duration = kind === 'land' ? 0.05 : 0.09
      osc.type = kind === 'break' || kind === 'land' ? 'square' : 'triangle'
      osc.frequency.setValueAtTime(tone, context.currentTime)
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, tone * 0.55), context.currentTime + duration)
      gain.gain.setValueAtTime(kind === 'jump' ? 0.018 : 0.025, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration)
      osc.connect(gain).connect(context.destination)
      osc.start()
      osc.stop(context.currentTime + duration)
    } catch { /* audio is optional and requires a gesture */ }
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

  private onMouseDown = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas || this.state !== 'play') return
    if (event.button === 0) this.breakBlock()
    else if (event.button === 2) this.placeBlock()
    else if (event.button === 1) {
      event.preventDefault()
      const index = this.target ? HOTBAR_BLOCKS.findIndex((item) => item.id === this.chunks.block(this.target!.x, this.target!.y, this.target!.z)) : -1
      if (index >= 0) this.select(index)
    }
  }

  private onContextMenu = (event: Event): void => { event.preventDefault() }

  private onWheel = (event: WheelEvent): void => {
    if (document.pointerLockElement !== this.canvas) return
    event.preventDefault()
    this.select(this.selected + (event.deltaY > 0 ? 1 : -1))
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
    if (event.code === 'KeyF' && this.state === 'play') {
      event.preventDefault()
      this.flying = !this.flying
      this.velocity.y = 0
      this.events.status(this.flying ? 'Flying — Space up, Shift down, Ctrl for speed.' : 'Walking — Space jumps, Shift sprints, Ctrl sneaks.', 'ok')
      return
    }
    if (/^Digit[1-9]$/.test(event.code)) {
      this.select(Number(event.code.slice(5)) - 1)
      return
    }
    this.keys.add(event.code)
    if (event.code === 'Space') event.preventDefault()
  }

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code)
  }

  private onBlur = (): void => {
    this.keys.clear()
  }
}

function approach(value: number, target: number, maxDelta: number): number {
  if (value < target) return Math.min(value + maxDelta, target)
  if (value > target) return Math.max(value - maxDelta, target)
  return target
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
