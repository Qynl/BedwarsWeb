import { expect, test } from 'bun:test'
import { once } from 'node:events'
import { createServer } from 'node:http'
import net from 'node:net'
import { WebSocket as WsClient } from 'ws'
import { createMcProxy, MC_PROXY_PATH } from '../src/server/mcproxy'

test('the site proxy can upgrade directly for serverless hosts', async () => {
  const echo = net.createServer((socket) => socket.pipe(socket))
  echo.listen(0, '127.0.0.1')
  await once(echo, 'listening')
  const echoPort = (echo.address() as net.AddressInfo).port

  const proxy = createMcProxy({ direct: true })
  const server = createServer((req, res) => {
    if (!proxy.handleRequest(req, res)) res.writeHead(404).end('not found')
  })
  server.on('upgrade', (req, socket, head) => {
    if (!proxy.handleUpgrade(req, socket, head)) socket.destroy()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as net.AddressInfo).port
  const base = `http://127.0.0.1:${port}`

  try {
    const health = await fetch(`${base}${MC_PROXY_PATH}`)
    expect(await health.json()).toMatchObject({ ok: true, direct: true })

    const socket = new WsClient(`ws://127.0.0.1:${port}${MC_PROXY_PATH}?host=127.0.0.1&port=${echoPort}`)
    await once(socket, 'open')
    socket.send(Buffer.from('direct hello'))
    const [data] = await once(socket, 'message')
    expect(Buffer.from(data as Buffer).toString()).toBe('direct hello')
    socket.close()
    await once(socket, 'close')
  } finally {
    proxy.close()
    server.close()
    echo.close()
  }
})

test('the site proxy tunnels raw bytes over its own WebSocket', async () => {
  const echo = net.createServer((socket) => socket.pipe(socket))
  echo.listen(0, '127.0.0.1')
  await once(echo, 'listening')
  const echoPort = (echo.address() as net.AddressInfo).port

  const proxy = createMcProxy()
  const server = createServer((req, res) => {
    if (!proxy.handleRequest(req, res)) res.writeHead(404).end('not found')
  })
  server.on('upgrade', (req, socket, head) => {
    if (!proxy.handleUpgrade(req, socket, head)) socket.destroy()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as net.AddressInfo).port
  const base = `http://127.0.0.1:${port}`

  try {
    const health = await fetch(`${base}${MC_PROXY_PATH}`)
    expect(await health.json()).toMatchObject({ ok: true })

    const response = await fetch(`${base}${MC_PROXY_PATH}/connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: '127.0.0.1', port: echoPort }),
    })
    expect(response.status).toBe(200)
    const { token } = (await response.json()) as { token: string }
    expect(typeof token).toBe('string')

    const socket = new WsClient(`ws://127.0.0.1:${port}${MC_PROXY_PATH}/socket?token=${token}`)
    await once(socket, 'open')
    socket.send(Buffer.from('hello from the browser'))
    const [data] = await once(socket, 'message')
    expect(Buffer.from(data as Buffer).toString()).toBe('hello from the browser')
    socket.close()
    await once(socket, 'close')
  } finally {
    proxy.close()
    server.close()
    echo.close()
  }
})
