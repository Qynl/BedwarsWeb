/**
 * Vercel entrypoint for our own Minecraft proxy.
 *
 * Vercel may run the token POST and the WebSocket on different Fluid instances,
 * so this deployment uses the proxy's direct upgrade mode: the WebSocket URL
 * carries host/port and the function opens the TCP socket for that connection.
 * Everything else (protocol framing, auth, limits) is shared with the Node
 * server in src/server/mcproxy.ts.
 */
import { createServer } from 'node:http'
import { createMcProxy } from '../src/server/mcproxy'

const proxy = createMcProxy({ direct: true, maxTunnels: 64 })

const server = createServer((req, res) => {
  if (proxy.handleRequest(req, res)) return
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('Not found')
})

server.on('upgrade', (req, socket, head) => {
  if (!proxy.handleUpgrade(req, socket, head)) socket.destroy()
})

export default server
