import { expect, test } from 'bun:test'
import { openTunnel } from '../src/mcclient/proxy'

class FakeSocket {
  static OPEN = 1
  static last: FakeSocket | null = null
  readyState = 0
  binaryType = ''
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: { reason: string }) => void) | null = null
  sent: Uint8Array[] = []
  private listeners = new Map<string, Array<() => void>>()

  constructor(public url: string) {
    FakeSocket.last = this
  }

  addEventListener(name: string, listener: () => void): void {
    const list = this.listeners.get(name) ?? []
    list.push(listener)
    this.listeners.set(name, list)
  }

  private emit(name: string): void {
    for (const listener of this.listeners.get(name) ?? []) listener()
  }

  open(): void {
    this.readyState = FakeSocket.OPEN
    this.emit('open')
  }

  message(data: Uint8Array): void {
    this.onmessage?.({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) })
  }

  serverClose(reason: string): void {
    this.readyState = 3
    this.onclose?.({ reason })
  }

  send(data: Uint8Array): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = 3
  }
}

test('the tunnel queues early bytes and close events until the client attaches', async () => {
  const realFetch = globalThis.fetch
  const realWebSocket = globalThis.WebSocket
  globalThis.fetch = (async () => new Response(JSON.stringify({ token: 'ticket' }), { status: 200 })) as unknown as typeof fetch
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
  try {
    const pending = openTunnel('example.org', 25565)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const socket = FakeSocket.last!
    socket.open()
    const tunnel = await pending

    socket.message(new Uint8Array([1, 2, 3]))
    const received: Uint8Array[] = []
    const closes: string[] = []
    tunnel.setHandlers((bytes) => received.push(bytes), (reason) => closes.push(reason))
    expect(received).toHaveLength(1)
    expect([...received[0]!]).toEqual([1, 2, 3])
    expect(closes).toHaveLength(0)

    tunnel.send(new Uint8Array([9]))
    expect([...socket.sent[0]!]).toEqual([9])

    socket.serverClose('server went away')
    expect(closes).toEqual(['server went away'])
  } finally {
    globalThis.fetch = realFetch
    globalThis.WebSocket = realWebSocket
  }
})

test('direct tunnels name the TCP target on the WebSocket URL', async () => {
  const realWebSocket = globalThis.WebSocket
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
  try {
    const pending = openTunnel('mc.example.org', 25565, { url: 'https://site.test/api/mc-proxy', direct: true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const socket = FakeSocket.last!
    expect(socket.url).toBe('wss://site.test/api/mc-proxy?host=mc.example.org&port=25565')
    socket.open()
    const tunnel = await pending
    expect(tunnel).toBeTruthy()
  } finally {
    globalThis.WebSocket = realWebSocket
  }
})
