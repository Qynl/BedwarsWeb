/**
 * A small WebSocket-to-TCP bridge for the in-browser Minecraft client.
 *
 * This is the same protocol as PrismarineJS net-browserify (`POST /connect`
 * returns a one-use token, then `/socket?token=` carries raw bytes), but it is
 * hosted by our own server. It means `bun run start`, `bun run share` and the
 * desktop app do not send players through a third-party proxy. Static/Sites
 * builds have no Node process, so the client falls back to the public proxy.
 *
 * The bridge necessarily opens arbitrary TCP destinations on a visitor's
 * behalf. Keep it on a trusted deployment or put it behind the site's normal
 * access controls. Tokens expire quickly, are single use, and concurrent
 * tunnels are capped.
 */
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import net from 'node:net'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'

export const MC_PROXY_PATH = '/api/mc-proxy'
export const MC_PROXY_SOCKET_PATH = `${MC_PROXY_PATH}/socket`
export const MC_PROXY_CONNECT_PATH = `${MC_PROXY_PATH}/connect`

export interface McProxyOptions {
  /** How long a `POST /connect` socket waits for the browser's WebSocket. */
  tokenTtlMs?: number
  /** How long the TCP handshake may take. */
  connectTimeoutMs?: number
  /** Maximum simultaneous tunnels (each is one Minecraft connection). */
  maxTunnels?: number
  /** Maximum unclaimed tokens waiting for their WebSocket. */
  maxPending?: number
  /**
   * Allow `WS /api/mc-proxy?host=…&port=…` without the POST token handshake.
   * Serverless hosts (Vercel) may run the POST and the WebSocket on different
   * instances, so they cannot share the pending-socket map. Only enable this on
   * a deployment that already trusts same-origin visitors.
   */
  direct?: boolean
}

interface PendingTunnel {
  socket: net.Socket
  expires: number
}

const MAX_BODY = 4096
const MAX_HOST = 253

/** True when a request is for the proxy's HTTP or WebSocket namespace. */
function isProxyPath(pathname: string): boolean {
  return pathname === MC_PROXY_PATH || pathname.startsWith(`${MC_PROXY_PATH}/`)
}

function json(res: ServerResponse, state: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(state, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function validHost(host: unknown): host is string {
  if (typeof host !== 'string') return false
  const value = host.trim()
  return value.length > 0 && value.length <= MAX_HOST && !/[\s/\\\0]/.test(value)
}

function validPort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535
}

/**
 * Creates the HTTP handler and upgrade handler. Attach both to the same Node
 * HTTP server; `handleRequest` returns true when it took the request.
 */
export function createMcProxy(options: McProxyOptions = {}) {
  const tokenTtl = options.tokenTtlMs ?? 15_000
  const connectTimeout = options.connectTimeoutMs ?? 10_000
  const maxTunnels = Math.max(1, options.maxTunnels ?? 64)
  const maxPending = Math.max(1, options.maxPending ?? 64)
  const pending = new Map<string, PendingTunnel>()
  const directPending = new Set<net.Socket>()
  const activeSockets = new Set<WebSocket>()
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
  let active = 0
  let closed = false

  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [token, entry] of pending) {
      if (entry.expires > now) continue
      pending.delete(token)
      entry.socket.destroy()
    }
  }, 5_000)
  sweep.unref?.()

  function handleRequest(req: IncomingMessage, res: ServerResponse): boolean {
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      return false
    }
    if (!isProxyPath(url.pathname)) return false

    if (url.pathname === MC_PROXY_PATH) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' }).end()
        return true
      }
      json(res, 200, { ok: true, name: 'SKYSHARD Minecraft proxy', protocol: 'net-browserify', direct: !!options.direct })
      return true
    }
    if (url.pathname !== MC_PROXY_CONNECT_PATH) {
      json(res, 404, { error: 'Unknown proxy endpoint.' })
      return true
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end()
      return true
    }
    if (pending.size >= maxPending) {
      json(res, 503, { error: 'The proxy is busy. Try again in a moment.' })
      return true
    }
    if (active >= maxTunnels) {
      json(res, 503, { error: 'The proxy has reached its connection limit.' })
      return true
    }

    let raw = ''
    let over = false
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      if (over) return
      raw += chunk
      if (raw.length > MAX_BODY) {
        over = true
        json(res, 413, { error: 'Request body is too large.' })
      }
    })
    req.on('end', () => {
      if (over || closed) return
      let body: { host?: unknown; port?: unknown }
      try {
        body = JSON.parse(raw) as { host?: unknown; port?: unknown }
      } catch {
        json(res, 400, { error: 'Expected a JSON object with host and port.' })
        return
      }
      if (!validHost(body.host) || !validPort(body.port)) {
        json(res, 400, { error: 'A valid host and port are required.' })
        return
      }
      const host = body.host.trim()
      const port = body.port
      const tcp = net.connect({ host, port })
      tcp.setNoDelay(true)
      let settled = false
      const fail = (message: string, state = 502) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        tcp.destroy()
        json(res, state, { error: message })
      }
      const timer = setTimeout(() => fail('The destination did not answer in time.', 504), connectTimeout)
      tcp.once('connect', () => {
        if (settled) { tcp.destroy(); return }
        settled = true
        clearTimeout(timer)
        // The socket may sit in `pending` before its WebSocket arrives; never
        // let a late ECONNRESET become an unhandled error on the server.
        tcp.on('error', () => { /* the WebSocket close path reports it if attached */ })
        const token = randomUUID()
        pending.set(token, { socket: tcp, expires: Date.now() + tokenTtl })
        json(res, 200, { token, host, port })
      })
      tcp.once('error', (error) => fail(error.message || 'The destination refused the connection.'))
    })
    req.on('error', () => { if (!res.headersSent) json(res, 400, { error: 'Could not read the request.' }) })
    return true
  }

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      return false
    }
    if (!isProxyPath(url.pathname)) return false
    if (url.pathname !== MC_PROXY_SOCKET_PATH && !(options.direct && url.pathname === MC_PROXY_PATH)) {
      socket.destroy()
      return true
    }
    if (active >= maxTunnels) {
      socket.destroy()
      return true
    }
    const attach = (tcp: net.Socket) => {
      wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        if (closed || socket.destroyed) { tcp.destroy(); ws.close(); return }
        active++
        activeSockets.add(ws)
        let ended = false
        const finish = () => {
          if (ended) return
          ended = true
          active = Math.max(0, active - 1)
          activeSockets.delete(ws)
          tcp.destroy()
          try { ws.close() } catch { /* already closed */ }
        }
        tcp.on('data', (data) => {
          if (ws.readyState === ws.OPEN) ws.send(data, { binary: true })
        })
        tcp.on('close', finish)
        tcp.on('error', finish)
        ws.on('message', (data, isBinary) => {
          if (ended || tcp.destroyed) return
          if (isBinary) tcp.write(data as Buffer)
          else tcp.write(String(data))
        })
        ws.on('close', finish)
        ws.on('error', finish)
      })
    }

    const token = url.searchParams.get('token')
    if (!token) {
      if (!options.direct) { socket.destroy(); return true }
      const host = url.searchParams.get('host')
      const port = Number(url.searchParams.get('port'))
      if (!validHost(host) || !validPort(port)) { socket.destroy(); return true }
      const tcp = net.connect({ host: host.trim(), port })
      tcp.setNoDelay(true)
      directPending.add(tcp)
      let opened = false
      const timer = setTimeout(() => {
        directPending.delete(tcp)
        tcp.destroy()
        socket.destroy()
      }, connectTimeout)
      tcp.once('connect', () => {
        clearTimeout(timer)
        directPending.delete(tcp)
        opened = true
        if (closed || socket.destroyed) { tcp.destroy(); return }
        attach(tcp)
      })
      tcp.once('error', () => {
        clearTimeout(timer)
        directPending.delete(tcp)
        socket.destroy()
      })
      socket.once('close', () => {
        if (!opened) {
          clearTimeout(timer)
          directPending.delete(tcp)
          tcp.destroy()
        }
      })
      return true
    }
    const entry = pending.get(token)
    if (!entry || entry.expires < Date.now()) {
      pending.delete(token)
      entry?.socket.destroy()
      socket.destroy()
      return true
    }
    pending.delete(token)
    attach(entry.socket)
    return true
  }

  function close(): void {
    closed = true
    clearInterval(sweep)
    for (const entry of pending.values()) entry.socket.destroy()
    pending.clear()
    for (const socket of directPending) socket.destroy()
    directPending.clear()
    for (const socket of activeSockets) {
      try { socket.close() } catch { /* already closed */ }
    }
    activeSockets.clear()
    wss.close()
  }

  return {
    handleRequest,
    handleUpgrade,
    close,
    /** Small read-only health/testing surface. */
    stats: () => ({ pending: pending.size, active }),
  }
}

/** Shared by the Vite dev plugin and the production server. */
export type McProxy = ReturnType<typeof createMcProxy>
