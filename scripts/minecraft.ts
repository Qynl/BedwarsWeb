/**
 * `bun run minecraft` — open a Minecraft: Java Edition server that joins the
 * game as a player. Point a vanilla client at the printed address.
 *
 *   MC_PORT=25565 MC_VERSION=1.21.8 bun run minecraft
 *   MC_GAME_URL='ws://127.0.0.1:3000/game?world=arena&room=mc&auto=1' bun run minecraft
 *   MC_HOST=0.0.0.0 bun run minecraft   # LAN, not just this machine
 */
import { DEFAULT_MC_PORT, DEFAULT_MC_VERSION, startMinecraftBridge } from '../src/games/bedwars/minecraft'

const port = Number(process.env.MC_PORT ?? DEFAULT_MC_PORT)
const version = process.env.MC_VERSION ?? DEFAULT_MC_VERSION
const gameUrl = process.env.MC_GAME_URL ?? `ws://127.0.0.1:${process.env.PORT ?? 3000}/game?world=arena&room=mc&auto=1`

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`MC_PORT must be a port number, got ${process.env.MC_PORT}`)
  process.exit(1)
}

const bridge = await startMinecraftBridge({
  port,
  version,
  host: process.env.MC_HOST ?? '127.0.0.1',
  gameUrl,
  log: (line) => console.log(`[minecraft] ${line}`),
})
console.log(`\n  Minecraft ${bridge.version}: multiplayer → Direct Connection → localhost:${bridge.port}\n  Offline mode: any name, no Mojang login. The game server must be running (npm start).\n`)
process.on('SIGINT', () => { bridge.close(); process.exit(0) })
process.on('SIGTERM', () => { bridge.close(); process.exit(0) })
