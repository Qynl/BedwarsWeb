/**
 * Browser-side half of net-browserify, the WebSocket-to-TCP bridge used by
 * PrismarineJS. A browser cannot open a TCP socket, so the public proxy opens
 * one for us and forwards the raw bytes. No game state is handled here.
 */

export const DEFAULT_PROXY = 'https://pproxy.rom1504.fr/api/vm/net'

export interface Tunnel {
  /** Send raw TCP bytes. */
  send(bytes: Uint8Array): void
  /** Attach the game client; bytes and closes that arrived earlier are replayed. */
  setHandlers(onData: (bytes: Uint8Array) => void, onClose: (reason: string) => void): void
  close(): void
}

interface Ticket {
  token?: string
  error?: string
}

export async function openTunnel(host: string, port: number, proxy = DEFAULT_PROXY): Promise<Tunnel> {
  const base = proxy.replace(/\/+$/, '')
  let response: Response
  try {
    response = await fetch(`${base}/connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host, port }),
      mode: 'cors',
    })
  } catch {
    throw new Error(`Could not reach the public proxy at ${new URL(base).host}.`)
  }
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as Ticket
      if (body.error) detail = body.error
    } catch { /* a plain-text error is fine */ }
    throw new Error(`The proxy refused ${host}:${port} (${detail}).`)
  }
  let ticket: Ticket
  try {
    ticket = (await response.json()) as Ticket
  } catch {
    throw new Error(`The proxy returned an unexpected response (HTTP ${response.status}).`)
  }
  if (!ticket.token) throw new Error('The proxy did not return a connection token.')

  const socket = new WebSocket(`${base.replace(/^http/i, 'ws')}/socket?token=${encodeURIComponent(ticket.token)}`)
  socket.binaryType = 'arraybuffer'

  let onData: ((bytes: Uint8Array) => void) | null = null
  let onClose: ((reason: string) => void) | null = null
  const early: Uint8Array[] = []
  let closed: string | null = null

  const deliver = (bytes: Uint8Array) => {
    if (onData) onData(bytes)
    else early.push(bytes)
  }
  const finish = (reason: string) => {
    if (closed) return
    closed = reason
    if (onClose) onClose(reason)
  }

  const tunnel: Tunnel = {
    send(bytes) {
      if (socket.readyState === WebSocket.OPEN) socket.send(bytes)
    },
    setHandlers(data, close) {
      onData = data
      onClose = close
      for (const bytes of early.splice(0)) data(bytes)
      if (closed) close(closed)
    },
    close() {
      try { socket.close() } catch { /* already closed */ }
    },
  }

  socket.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) deliver(new Uint8Array(event.data))
    else if (typeof event.data === 'string') deliver(new TextEncoder().encode(event.data))
  }
  socket.onerror = () => finish('The proxy connection failed.')
  socket.onclose = (event) => finish(event.reason || 'The proxy closed the connection.')

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
