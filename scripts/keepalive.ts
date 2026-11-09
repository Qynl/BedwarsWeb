/**
 * Keeps an Oracle Always Free A1 VM out of the idle-reclamation bucket by
 * holding about a quarter of its RAM. Oracle's rule looks at CPU, network and
 * memory together; one metric above 20% is enough to avoid the "idle" label.
 * It also makes a tiny outbound request so a quiet website still has traffic.
 *
 * Docker Compose starts this beside the game server. Remove the service if you
 * upgrade to Pay As You Go or want the RAM back.
 */
import { readFileSync } from 'node:fs'

const fraction = Math.max(0.2, Math.min(0.5, Number(process.env.KEEPALIVE_FRACTION) || 0.25))
const totalKb = Number(/MemTotal:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1] ?? 0)
const target = Math.floor(totalKb * 1024 * fraction)
console.log(`keepalive: holding ${(target / 1024 / 1024 / 1024).toFixed(1)} GiB (${Math.round(fraction * 100)}% of RAM)`)
const chunks: Buffer[] = []
let held = 0
while (held < target) {
  const size = Math.min(64 * 1024 * 1024, target - held)
  if (size <= 0) break
  chunks.push(Buffer.alloc(size, 1))
  held += size
}
// Touch the pages occasionally so the kernel does not consider them free.
setInterval(() => {
  for (const chunk of chunks) chunk[(Math.random() * chunk.length) | 0] = 1
}, 30_000)
// A little real network traffic, without generating meaningful bandwidth.
setInterval(() => { void fetch('https://api.ipify.org').catch(() => {}) }, 30_000)
