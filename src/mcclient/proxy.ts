/**
 * Browser-side half of net-browserify, the WebSocket-to-TCP bridge used by
 * PrismarineJS. A browser cannot open a TCP socket, so the public proxy opens
 * one for us and forwards the raw bytes. No game state is handled here.
 */

export const DEFAULT_PROXY = 'https://pproxy.rom1504.fr/api/vm/net'

export interface Tunnel {
  /** Send raw TCP bytes. */
  send(bytes: Uint8Array): void
  /** Called with each chunk of raw TCP bytes. */
  onData: (bytes: Uint8Array) => void
  onClose: (reason: string) => void
  close(): void
}

interface Ticket {
  token?: string
  error?: string
}

export async function openTunnel(host: string, port: number, proxy = DEFAULT_PROXY): Promise<Tunnel> {
  const base = proxy.replace(/\/+$/, '')
  const response = await fetch(`${base}/connect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ host, port }),
    mode: 'cors',
  })
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as Ticket
      if (body.error) detail = body.error
    } catch { /* a plain-text error is fine */ }
    throw new Error(`The proxy refused ${host}:${port} (${detail}).`)
  }
  const ticket = (await response.json()) as Ticket
  if (!ticket.token) throw new Error('The proxy did not return a connection token.')

  const socket = new WebSocket(`${base.replace(/^http/i, 'ws')}/socket?token=${encodeURIComponent(ticket.token)}`)
  socket.binaryType = 'arraybuffer'

  const tunnel: Tunnel = {
    send(bytes) {
      if (socket.readyState === WebSocket.OPEN) socket.send(bytes)
    },
    onData: () => {},
    onClose: () => {},
    close() {
      try { socket.close() } catch { /* already closed */ }
    },
  }

  socket.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) tunnel.onData(new Uint8Array(event.data))
    else if (typeof event.data === 'string') tunnel.onData(new TextEncoder().encode(event.data))
  }
  socket.onerror = () => tunnel.onClose('The proxy connection failed.')
  socket.onclose = (event) => tunnel.onClose(event.reason || 'The proxy closed the connection.')

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The proxy did not open the WebSocket in time.')), 15_000)
    const done = () => { clearTimeout(timer); resolve() }
    const failed = () => { clearTimeout(timer); reject(new Error('The proxy refused the WebSocket.')) }
    if (socket.readyState === WebSocket.OPEN) return done()
    socket.addEventListener('open', done, { once: true })
    socket.addEventListener('error', failed, { once: true })
    socket.addEventListener('close', failed, { once: true })
  })

  return tunnel
}
