/**
 * `bun run share` — the whole thing on one machine: the website, the Java
 * Edition gateway, and (when Java is installed) a free public e4mc tunnel.
 *
 * No account, no port forwarding, no server rental. The e4mc relay is a public
 * third-party service; the Minecraft port is still served by this process.
 * `--no-public` keeps it local/LAN only.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir, networkInterfaces } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { DEFAULT_MC_VERSION, startMinecraftBridge, type MinecraftBridge } from '../src/games/bedwars/minecraft'
import { startServer } from '../src/server/main'

const E4MC_VERSION = '0.2.2'
const E4MC_JAR_URL = `https://github.com/DuncanRuns/e4mcbiat/releases/download/v${E4MC_VERSION}/e4mcbiat-${E4MC_VERSION}-all.jar`
const JAR_DIR = resolve('.cache')
const JAR_PATH = join(JAR_DIR, `e4mcbiat-${E4MC_VERSION}-all.jar`)

const argv = process.argv.slice(2)
const localOnly = argv.includes('--no-public') || argv.includes('--local')
const httpPort = Number(process.env.PORT ?? 3000)
const mcPort = Number(process.env.MC_PORT ?? 25565)
const mcHost = process.env.MC_HOST ?? '0.0.0.0'
const workers = Number(process.env.WORKERS) || 1

if (!Number.isInteger(httpPort) || httpPort < 1 || httpPort > 65535) fail('PORT must be a port number')
if (!Number.isInteger(mcPort) || mcPort < 1 || mcPort > 65535) fail('MC_PORT must be a port number')
if (httpPort === mcPort) fail('PORT and MC_PORT must be different')

const clientDir = resolve('dist/node-client')
if (!existsSync(join(clientDir, 'index.html'))) {
  console.log('Building the browser client first (dist/node-client is missing)…')
  const built = spawnSync(process.execPath, ['run', 'build:node'], { stdio: 'inherit' })
  if (built.status !== 0) fail('The client build failed; run `bun run build:node` and try again.')
}

// The menu asks /api/minecraft; set these before the HTTP server starts.
process.env.MC_PORT = String(mcPort)
process.env.MC_HOST = mcHost
process.env.MC_VERSION = process.env.MC_VERSION ?? DEFAULT_MC_VERSION

let server: Awaited<ReturnType<typeof startServer>>['server'] | null = null
let bridge: MinecraftBridge | null = null
let tunnel: ChildProcess | null = null
let closing = false

const shutdown = (signal: string) => {
  if (closing) return
  closing = true
  console.log(`\n${signal}: closing…`)
  if (tunnel) { try { tunnel.kill('SIGTERM') } catch { /* already gone */ } }
  bridge?.close()
  server?.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2500).unref()
}
process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))

try {
  const started = await startServer({ port: httpPort, host: '0.0.0.0', staticDir: clientDir, workers })
  server = started.server
  const url = `http://localhost:${started.port}`
  console.log(`\n  Website:       ${url}`)
  for (const ip of lanAddresses()) console.log(`  On your LAN:   http://${ip}:${started.port}`)

  bridge = await startMinecraftBridge({
    port: mcPort,
    host: mcHost,
    version: process.env.MC_VERSION,
    gameUrl: `ws://127.0.0.1:${started.port}/game?world=arena&room=mc-public&auto=1`,
    whitelist: (process.env.MC_WHITELIST ?? '').split(',').map((name) => name.trim()).filter(Boolean),
    log: (line) => console.log(`[minecraft] ${line}`),
  })
  console.log(`  Minecraft:     localhost:${bridge.port}  (Java ${bridge.version})`)
  for (const ip of lanAddresses()) console.log(`  Minecraft LAN: ${ip}:${bridge.port}`)
  if (mcHost === '0.0.0.0') console.log('  The Java listener is offline-mode: anyone who can reach it (LAN or the public address) can use any name.')

  if (localOnly) {
    console.log('\n  Public sharing is off (--no-public). Browser play and local/LAN Minecraft are running.\n')
  } else if (process.env.MC_PUBLIC_URL) {
    console.log(`\n  Public Minecraft: ${process.env.MC_PUBLIC_URL} (from MC_PUBLIC_URL)\n`)
  } else if (process.env.MC_TUNNEL_CMD) {
    console.log('\n  Starting MC_TUNNEL_CMD…\n')
    tunnel = spawn(process.env.MC_TUNNEL_CMD, { shell: true, stdio: 'inherit' })
    tunnel.once('exit', (code) => console.log(`\n  Tunnel exited (${code ?? 'signal'}); the local server is still running.`))
  } else {
    // A relay problem must never take down the website or the local listener.
    try { await startE4mc(bridge.port) } catch (error) { console.log(`\n  Public tunnel failed: ${(error as Error).message}`) }
  }
} catch (error) {
  console.error(`\nCould not start the shared server: ${(error as Error).message}`)
  shutdown('startup error')
}

async function startE4mc(port: number): Promise<void> {
  const java = findJava()
  if (!java) {
    console.log('\n  Java was not found, so the free public e4mc tunnel cannot start.')
    console.log('  Install Java 11+ (the Minecraft launcher usually includes one), or set JAVA=/path/to/java.')
    console.log('  Browser play and local/LAN Minecraft are running.\n')
    return
  }
  let jar = process.env.E4MC_JAR ?? JAR_PATH
  if (!existsSync(jar)) {
    console.log('\n  Downloading the e4mc relay helper (one time, ~5 MB)…')
    try {
      const response = await fetch(E4MC_JAR_URL)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength < 1_000_000) throw new Error('the download looks truncated')
      await mkdir(JAR_DIR, { recursive: true })
      await writeFile(jar, bytes)
    } catch (error) {
      console.log(`  Could not download the relay helper: ${(error as Error).message}`)
      console.log('  Browser play and local/LAN Minecraft are running. Set MC_TUNNEL_CMD to use another tunnel.\n')
      return
    }
  }
  console.log('\n  Asking e4mc for a free public address…')
  const child = spawn(java, ['-jar', jar, `port=${port}`, 'nogui'], { stdio: ['ignore', 'pipe', 'pipe'] })
  tunnel = child
  const onLine = (line: string) => {
    const text = line.trim()
    if (!text) return
    console.log(`  [e4mc] ${text}`)
    const domain = /Connected,\s*domain:\s*(\S+)/i.exec(text)?.[1]
    if (!domain) return
    process.env.MC_PUBLIC_URL = domain
    console.log(`\n  Public Minecraft: ${domain}`)
    console.log('  Vanilla Java 1.21.8 clients: Multiplayer → Direct Connection → paste that address.\n')
  }
  createInterface({ input: child.stdout }).on('line', onLine)
  createInterface({ input: child.stderr }).on('line', onLine)
  child.once('exit', (code) => {
    console.log(`  e4mc exited (${code ?? 'signal'}); the website and local/LAN Minecraft are still running.`)
    tunnel = null
    delete process.env.MC_PUBLIC_URL
  })
}

/** The launcher bundles Java but often does not put it on PATH; look there too. */
function findJava(): string | null {
  const works = (cmd: string) => {
    const run = spawnSync(cmd, ['-version'], { stdio: 'ignore' })
    return !run.error && run.status === 0
  }
  const explicit = process.env.JAVA
  if (explicit && works(explicit)) return explicit
  if (works('java')) return 'java'
  const home = homedir()
  const roots = [
    process.env.JAVA_HOME && join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'),
    join(home, '.minecraft', 'runtime'),
    join(home, '.local', 'share', 'minecraft', 'runtime'),
    join(home, 'Library', 'Application Support', 'minecraft', 'runtime'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Packages', 'Microsoft.4297127D64EC6_8wekyb3d8bbwe', 'LocalCache', 'Local', 'runtime'),
    process.env.APPDATA && join(process.env.APPDATA, '.minecraft', 'runtime'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Minecraft Launcher', 'runtime'),
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)']!, 'Minecraft Launcher', 'runtime'),
    '/Applications/Minecraft.app/Contents/runtime/Contents/Home/bin/java',
  ].filter((root): root is string => !!root)
  for (const root of roots) {
    if (!existsSync(root)) continue
    if (works(root)) return root
    for (const found of findJavaUnder(root, 0)) if (works(found)) return found
  }
  return null
}

function findJavaUnder(dir: string, depth: number): string[] {
  if (depth > 6) return []
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return [] }
  const found: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isFile() && (entry.name === 'java' || entry.name === 'java.exe')) found.push(full)
    else if (entry.isDirectory()) found.push(...findJavaUnder(full, depth + 1))
  }
  return found
}

function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address)
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
