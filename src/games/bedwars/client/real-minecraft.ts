/**
 * A launcher for a real Minecraft: Java Edition client that runs in the
 * browser. Our voxel game speaks its own protocol, so it cannot join a normal
 * Minecraft server. PrismarineJS's web client can: it runs mineflayer in the
 * page and reaches the server through a WebSocket-to-TCP proxy.
 *
 * This deliberately opens the upstream client in a new tab instead of bundling
 * Minecraft assets into this project. Only offline-mode ("cracked") servers
 * work: a browser cannot complete Microsoft's session handshake for
 * online-mode servers.
 */

const CLIENT = 'https://prismarinejs.github.io/prismarine-web-client/'
const EAGLERCRAFT = 'https://eaglercraft.com/play/'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** `play.example.net`, `play.example.net:25565`; no schemes, paths or spaces. */
export function cleanServerAddress(raw: string): string | null {
  const value = raw.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '')
  if (!value || value.length > 260) return null
  const match = /^((?:[a-zA-Z0-9_-]+\.)*[a-zA-Z0-9_-]+)(?::(\d{1,5}))?$/.exec(value)
  if (!match) return null
  const port = match[2] === undefined ? undefined : Number(match[2])
  if (port !== undefined && (port < 1 || port > 65535)) return null
  return port === undefined ? match[1] : `${match[1]}:${port}`
}

/** Java offline-mode names are 1–16 letters, digits or underscores. */
export function cleanPlayerName(raw: string): string | null {
  const value = raw.trim()
  return /^[A-Za-z0-9_]{1,16}$/.test(value) ? value : null
}

export function clientUrl(address: string, name: string, version: string): string {
  const url = new URL(CLIENT)
  url.searchParams.set('address', address)
  url.searchParams.set('username', name)
  if (version) url.searchParams.set('version', version)
  return url.href
}

/** Opens the form. `name` is the name typed on our menu, used as the default. */
export function openRealMinecraft(host: HTMLElement, name: string): void {
  const overlay = document.createElement('div')
  overlay.className = 'modal show real-mc'
  overlay.innerHTML = `
    <div class="window narrow" role="dialog" aria-modal="true" aria-labelledby="real-mc-title">
      <div class="window-head">
        <h2 id="real-mc-title">Real Minecraft</h2>
        <button class="btn ghost" data-close aria-label="Close">✕</button>
      </div>
      <p class="lead">A real Java Edition client in your browser, for <b>offline-mode</b> servers that accept any name. This is the open-source PrismarineJS client, not our voxel game; online-mode servers need a Microsoft account and will refuse it.</p>
      <label class="field"><span>Server address</span>
        <input id="real-host" maxlength="260" placeholder="play.example.net or play.example.net:25565" autocomplete="off" spellcheck="false">
      </label>
      <label class="field"><span>Username</span>
        <input id="real-name" maxlength="16" placeholder="Your name" autocomplete="off" spellcheck="false" value="${esc(name)}">
      </label>
      <label class="field"><span>Client version</span>
        <select id="real-version">
          <option value="1.18.2">1.18.2 (default)</option>
          <option value="">Auto-detect</option>
          <option value="1.8.9">1.8.9</option>
          <option value="1.12.2">1.12.2</option>
          <option value="1.16.5">1.16.5</option>
          <option value="1.19.3">1.19.3</option>
        </select>
      </label>
      <p class="real-error" id="real-error" role="alert"></p>
      <div class="menu-pair">
        <button class="btn primary" data-open>Open client</button>
        <a class="btn" href="${EAGLERCRAFT}" target="_blank" rel="noopener noreferrer">Eaglercraft 1.8</a>
      </div>
      <p class="muted small">The client opens in a new tab on prismarinejs.github.io (MIT). Keep this page open if you want to come back. A server only accepts this if it has <code>online-mode=false</code>.</p>
    </div>`
  host.append(overlay)

  const close = () => overlay.remove()
  const error = overlay.querySelector<HTMLParagraphElement>('#real-error')!
  const hostInput = overlay.querySelector<HTMLInputElement>('#real-host')!
  const nameInput = overlay.querySelector<HTMLInputElement>('#real-name')!
  const version = overlay.querySelector<HTMLSelectElement>('#real-version')!

  const open = () => {
    const address = cleanServerAddress(hostInput.value)
    const player = cleanPlayerName(nameInput.value)
    if (!address) {
      error.textContent = 'Enter a server address like play.example.net or play.example.net:25565.'
      hostInput.focus()
      return
    }
    if (!player) {
      error.textContent = 'Use 1–16 letters, digits or underscores for the username.'
      nameInput.focus()
      return
    }
    // A real anchor click is a user gesture, so pop-up blockers leave it alone;
    // unlike window.open with noopener it also needs no return-value guessing.
    const link = document.createElement('a')
    link.href = clientUrl(address, player, version.value)
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.click()
    close()
  }

  overlay.querySelector('[data-close]')!.addEventListener('click', close)
  overlay.querySelector('[data-open]')!.addEventListener('click', open)
  overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) close() })
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); close() }
    if (event.key === 'Enter') { event.preventDefault(); open() }
  })
  hostInput.focus()
}
