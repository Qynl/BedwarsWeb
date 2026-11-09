/** The tiny block table and chunk store used by the browser client. */
import type { ChunkColumn } from './protocol'

/** Block ids are Java 1.8 ids. Colours are ours, not Mojang textures. */
const COLOURS: Record<number, [number, number, number]> = {
  1: [0.50, 0.50, 0.50], 2: [0.42, 0.65, 0.29], 3: [0.48, 0.32, 0.19], 4: [0.44, 0.44, 0.44],
  5: [0.69, 0.54, 0.35], 7: [0.16, 0.16, 0.18], 8: [0.20, 0.33, 0.65], 9: [0.20, 0.33, 0.65],
  10: [0.83, 0.35, 0.10], 11: [0.83, 0.35, 0.10], 12: [0.85, 0.81, 0.60], 13: [0.54, 0.52, 0.50],
  14: [0.60, 0.55, 0.30], 15: [0.66, 0.62, 0.58], 16: [0.18, 0.18, 0.18], 17: [0.42, 0.31, 0.17],
  18: [0.25, 0.48, 0.17], 19: [0.45, 0.66, 0.27], 20: [0.74, 0.84, 0.88], 21: [0.25, 0.35, 0.65],
  22: [0.20, 0.30, 0.60], 23: [0.55, 0.55, 0.55], 24: [0.84, 0.78, 0.56], 25: [0.55, 0.38, 0.25],
  29: [0.55, 0.48, 0.28], 30: [0.85, 0.85, 0.85], 35: [0.91, 0.91, 0.91], 41: [0.95, 0.83, 0.28],
  42: [0.72, 0.72, 0.72], 45: [0.60, 0.35, 0.29], 46: [0.74, 0.18, 0.18], 47: [0.55, 0.43, 0.28],
  48: [0.38, 0.47, 0.38], 49: [0.14, 0.10, 0.20], 50: [0.95, 0.75, 0.30], 52: [0.18, 0.20, 0.25],
  53: [0.69, 0.54, 0.35], 54: [0.55, 0.38, 0.20], 57: [0.34, 0.85, 0.83], 58: [0.55, 0.38, 0.22],
  60: [0.36, 0.25, 0.14], 61: [0.50, 0.50, 0.50], 62: [0.50, 0.50, 0.50], 73: [0.68, 0.38, 0.35],
  74: [0.78, 0.62, 0.58], 78: [0.92, 0.94, 0.96], 79: [0.66, 0.84, 0.94], 80: [0.92, 0.94, 0.96],
  81: [0.24, 0.48, 0.18], 82: [0.62, 0.66, 0.72], 83: [0.30, 0.55, 0.25], 84: [0.50, 0.35, 0.22],
  85: [0.60, 0.46, 0.30], 86: [0.80, 0.48, 0.16], 87: [0.48, 0.19, 0.19], 88: [0.36, 0.25, 0.20],
  89: [0.94, 0.82, 0.52], 95: [0.70, 0.82, 0.90], 96: [0.55, 0.38, 0.22], 98: [0.47, 0.47, 0.47],
  99: [0.72, 0.66, 0.53], 100: [0.65, 0.18, 0.15], 101: [0.55, 0.55, 0.55], 102: [0.74, 0.84, 0.88],
  103: [0.55, 0.72, 0.20], 106: [0.22, 0.48, 0.18], 107: [0.60, 0.46, 0.30], 108: [0.60, 0.35, 0.29],
  109: [0.47, 0.47, 0.47], 110: [0.42, 0.48, 0.42], 111: [0.28, 0.56, 0.22], 112: [0.23, 0.13, 0.17],
  114: [0.44, 0.28, 0.18], 115: [0.72, 0.30, 0.26], 116: [0.55, 0.38, 0.25], 117: [0.55, 0.38, 0.25],
  118: [0.50, 0.50, 0.50], 120: [0.55, 0.45, 0.30], 121: [0.84, 0.84, 0.62], 125: [0.69, 0.54, 0.35],
  128: [0.84, 0.78, 0.56], 129: [0.32, 0.80, 0.55], 133: [0.32, 0.80, 0.55], 134: [0.45, 0.32, 0.22],
  135: [0.60, 0.50, 0.30], 136: [0.62, 0.50, 0.35], 137: [0.55, 0.48, 0.40], 139: [0.44, 0.44, 0.44],
  141: [0.36, 0.52, 0.20], 142: [0.42, 0.60, 0.24], 143: [0.55, 0.38, 0.22], 145: [0.42, 0.42, 0.44],
  146: [0.55, 0.36, 0.22], 147: [0.80, 0.68, 0.28], 148: [0.72, 0.70, 0.70], 149: [0.50, 0.50, 0.50],
  150: [0.70, 0.70, 0.70], 151: [0.60, 0.50, 0.35], 152: [0.55, 0.10, 0.10], 153: [0.65, 0.35, 0.32],
  154: [0.30, 0.30, 0.32], 155: [0.92, 0.90, 0.86], 156: [0.85, 0.82, 0.76], 157: [0.60, 0.50, 0.35],
  158: [0.32, 0.30, 0.30], 159: [0.70, 0.38, 0.30], 160: [0.70, 0.82, 0.90], 161: [0.30, 0.50, 0.20],
  162: [0.42, 0.31, 0.17], 163: [0.42, 0.45, 0.25], 164: [0.45, 0.32, 0.22], 168: [0.25, 0.50, 0.45],
  169: [0.70, 0.82, 0.86], 170: [0.72, 0.62, 0.22], 171: [0.91, 0.91, 0.91], 172: [0.54, 0.44, 0.36],
  173: [0.12, 0.12, 0.12], 174: [0.66, 0.84, 0.94], 175: [0.30, 0.58, 0.22],
}

export function isOpaqueBlock(id: number): boolean {
  return id !== 0
}

export function blockColour(id: number): [number, number, number] {
  return COLOURS[id] ?? [0.55, 0.40, 0.45]
}

export class ChunkStore {
  private readonly chunks = new Map<string, ChunkColumn>()

  static key(x: number, z: number): string {
    return `${x},${z}`
  }

  set(chunk: ChunkColumn): void {
    const key = ChunkStore.key(chunk.x, chunk.z)
    const old = this.chunks.get(key)
    if (old && !chunk.full) {
      // Ground-up=false packets only replace the sections they include.
      for (let section = 0; section < 16; section++) {
        if ((chunk.sections & (1 << section)) === 0) continue
        old.blocks.set(chunk.blocks.subarray(section * 4096, (section + 1) * 4096), section * 4096)
      }
      old.sections |= chunk.sections
      return
    }
    this.chunks.set(key, chunk)
  }

  has(x: number, z: number): boolean {
    return this.chunks.has(ChunkStore.key(x, z))
  }

  get(x: number, z: number): ChunkColumn | undefined {
    return this.chunks.get(ChunkStore.key(x, z))
  }

  clear(): void {
    this.chunks.clear()
  }

  all(): ChunkColumn[] {
    return [...this.chunks.values()]
  }

  /** Nearest chunks first, for a rough render-distance cap. */
  near(x: number, z: number, radius: number): ChunkColumn[] {
    const cx = Math.floor(x / 16)
    const cz = Math.floor(z / 16)
    return this.all()
      .filter((chunk) => Math.hypot(chunk.x - cx, chunk.z - cz) <= radius)
      .sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz))
  }

  setBlock(x: number, y: number, z: number, id: number): boolean {
    if (y < 0 || y > 255) return false
    const chunk = this.chunks.get(ChunkStore.key(Math.floor(x / 16), Math.floor(z / 16)))
    if (!chunk) return false
    chunk.blocks[(y << 8) | ((z & 15) << 4) | (x & 15)] = id
    return true
  }

  block(x: number, y: number, z: number): number {
    if (y < 0 || y > 255) return 0
    const chunk = this.chunks.get(ChunkStore.key(Math.floor(x / 16), Math.floor(z / 16)))
    if (!chunk) return 0
    const lx = x & 15
    const lz = z & 15
    return chunk.blocks[(y << 8) | (lz << 4) | lx]
  }
}
