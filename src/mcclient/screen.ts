import './style.css'
import { RealClient } from './client'
import { blockColour, HOTBAR_BLOCKS } from './world'

export function openRealClient(): () => void {
  const root = document.createElement('div')
  root.id = 'mc-root'
  document.body.append(root)
  root.innerHTML = `
    <canvas id="mc-canvas"></canvas>
    <section class="mc-panel" id="mc-panel">
      <div class="mc-window">
        <div class="mc-head">
          <h1>Real Minecraft <span>1.8.9 · beta</span></h1>
          <button class="mc-close" id="mc-close" title="Back to SKYSHARD">✕</button>
        </div>
        <p class="mc-lead">Our own browser client for real Java Edition servers. It logs in with an offline name, reads the server's terrain, lets you walk, jump and fly, and break or place blocks. No Minecraft files or textures are used.</p>
        <form id="mc-form">
          <label class="mc-field"><span>Server address</span>
            <input id="mc-host" placeholder="play.example.net or play.example.net:25565" autocomplete="off" spellcheck="false" required>
          </label>
          <label class="mc-field"><span>Username</span>
            <input id="mc-name" maxlength="16" placeholder="Steve" autocomplete="off" spellcheck="false" required>
          </label>
          <p class="mc-status" id="mc-status">Ready. The server must have <code>online-mode=false</code>.</p>
          <div class="mc-actions">
            <button class="mc-btn primary" type="submit">Connect</button>
            <button class="mc-btn" type="button" id="mc-back">Back</button>
          </div>
        </form>
        <p class="mc-note">Walk with <b>WASD</b>, jump with <b>Space</b>, sprint with <b>Shift</b>, sneak with <b>Ctrl</b>. Press <b>F</b> to fly (Space/Shift up and down) and <b>1–9</b> or the wheel to choose a block. Left-click breaks, right-click places, <b>T</b> chats. Other players, mobs, block updates and hearts are rendered; containers, crafting, skins and online-mode login are not.</p>
      </div>
    </section>
    <div class="mc-hud" id="mc-hud" hidden>
      <div class="mc-crosshair" aria-hidden="true"></div>
      <div class="mc-hud-left">
        <b>Real Minecraft</b><span id="mc-world">waiting for chunks…</span><span id="mc-coords"></span>
        <span class="mc-stats"><span id="mc-health">HP 20</span><span id="mc-food">FOOD 20</span></span>
      </div>
      <div class="mc-hud-right"><button class="mc-btn small" id="mc-leave">Leave</button></div>
      <div class="mc-held" id="mc-held">Grass block</div>
      <div class="mc-hotbar" id="mc-hotbar"></div>
      <div class="mc-hint" id="mc-hint">Click to look · WASD move · Space jump · Shift sprint · F fly · L/R click break/place · T chat · Esc releases</div>
      <div class="mc-chat" id="mc-chat" hidden></div>
      <input class="mc-chat-input" id="mc-chat-input" maxlength="100" placeholder="Say something…" hidden>
    </div>`

  const canvas = document.getElementById('mc-canvas') as HTMLCanvasElement
  const panel = document.getElementById('mc-panel')!
  const form = document.getElementById('mc-form') as HTMLFormElement
  const hostInput = document.getElementById('mc-host') as HTMLInputElement
  const nameInput = document.getElementById('mc-name') as HTMLInputElement
  const status = document.getElementById('mc-status')!
  const hud = document.getElementById('mc-hud')!
  const worldStatus = document.getElementById('mc-world')!
  const coords = document.getElementById('mc-coords')!
  const hint = document.getElementById('mc-hint')!
  const chatBox = document.getElementById('mc-chat')!
  const chatInput = document.getElementById('mc-chat-input') as HTMLInputElement
  const hotbar = document.getElementById('mc-hotbar')!
  const held = document.getElementById('mc-held')!
  const health = document.getElementById('mc-health')!
  const food = document.getElementById('mc-food')!

  for (const [index, item] of HOTBAR_BLOCKS.entries()) {
    const slot = document.createElement('div')
    slot.className = 'mc-slot'
    slot.title = `${index + 1} · ${item.name}`
    const [r, g, b] = blockColour(item.id)
    const swatch = document.createElement('span')
    swatch.className = 'mc-swatch'
    swatch.style.background = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
    const key = document.createElement('b')
    key.textContent = String(index + 1)
    slot.append(swatch, key)
    hotbar.append(slot)
  }
  hotbar.children[0]?.classList.add('active')

  let client: RealClient
  try {
    client = new RealClient(canvas, {
      status(text, kind = 'info') {
        status.textContent = text
        status.dataset.kind = kind
        worldStatus.textContent = text
      },
      chat(line) {
        addChat(line)
      },
      joined() {
        panel.hidden = true
        hud.hidden = false
        root.classList.add('playing')
        canvas.focus()
      },
      disconnected(reason) {
        panel.hidden = false
        hud.hidden = true
        root.classList.remove('playing')
        status.textContent = reason
        status.dataset.kind = 'error'
      },
      moved(x, y, z) {
        coords.textContent = `${x.toFixed(1)} ${y.toFixed(1)} ${z.toFixed(1)}`
      },
      selected(index, item) {
        for (const [i, slot] of [...hotbar.children].entries()) slot.classList.toggle('active', i === index)
        held.textContent = item.name
      },
      stats(currentHealth, currentFood) {
        health.textContent = `HP ${Math.max(0, Math.ceil(currentHealth))}`
        food.textContent = `FOOD ${Math.max(0, Math.ceil(currentFood))}`
      },
    })
  } catch (error) {
    form.hidden = true
    status.textContent = `WebGL is unavailable in this browser (${(error as Error).message}). Enable hardware acceleration and try again.`
    status.dataset.kind = 'error'
    const closeFailed = () => root.remove()
    document.getElementById('mc-close')!.addEventListener('click', closeFailed)
    document.getElementById('mc-back')!.addEventListener('click', closeFailed)
    return closeFailed
  }

  function parseAddress(raw: string): { host: string; port: number } | null {
    const value = raw.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '')
    const match = /^((?:[a-zA-Z0-9_-]+\.)*[a-zA-Z0-9_-]+)(?::(\d{1,5}))?$/.exec(value)
    if (!match) return null
    const port = match[2] === undefined ? 25565 : Number(match[2])
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null
    return { host: match[1], port }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const address = parseAddress(hostInput.value)
    const name = nameInput.value.trim()
    if (!address) {
      status.textContent = 'Enter an address like play.example.net or play.example.net:25565.'
      status.dataset.kind = 'error'
      hostInput.focus()
      return
    }
    if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) {
      status.textContent = 'Use 1–16 letters, digits or underscores for the username.'
      status.dataset.kind = 'error'
      nameInput.focus()
      return
    }
    try { localStorage.setItem('mc-name', name) } catch { /* private mode */ }
    status.dataset.kind = 'info'
    void client.connect(address.host, address.port, name)
  })

  let cleanup = () => {}
  let closed = false
  document.getElementById('mc-close')!.addEventListener('click', () => cleanup())
  document.getElementById('mc-back')!.addEventListener('click', () => cleanup())
  document.getElementById('mc-leave')!.addEventListener('click', () => {
    client.disconnect()
    panel.hidden = false
    hud.hidden = true
    root.classList.remove('playing')
  })

  canvas.addEventListener('click', () => {
    if (hud.hidden) return
    if (document.pointerLockElement !== canvas) void canvas.requestPointerLock()
  })
  const onLockChange = (): void => {
    hint.hidden = document.pointerLockElement === canvas
  }
  document.addEventListener('pointerlockchange', onLockChange)

  function addChat(line: string): void {
    if (!line.trim()) return
    chatBox.hidden = false
    const row = document.createElement('div')
    row.textContent = line
    chatBox.append(row)
    while (chatBox.children.length > 8) chatBox.firstElementChild?.remove()
    chatBox.scrollTop = chatBox.scrollHeight
  }

  const onChatKey = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement) return
    if ((event.code === 'KeyT' || event.code === 'Slash') && !hud.hidden) {
      event.preventDefault()
      chatInput.hidden = false
      chatBox.hidden = false
      chatInput.value = event.code === 'Slash' ? '/' : ''
      chatInput.focus()
      if (document.pointerLockElement === canvas) document.exitPointerLock()
    }
  }
  window.addEventListener('keydown', onChatKey, true)

  chatInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      chatInput.hidden = true
      chatInput.blur()
      return
    }
    if (event.key !== 'Enter') return
    event.preventDefault()
    const line = chatInput.value.trim()
    chatInput.value = ''
    chatInput.hidden = true
    chatInput.blur()
    if (line) client.say(line)
  })

  try {
    const saved = localStorage.getItem('mc-name')
    if (saved) nameInput.value = saved
  } catch { /* private mode */ }
  nameInput.focus()

  cleanup = () => {
    if (closed) return
    closed = true
    window.removeEventListener('keydown', onChatKey, true)
    document.removeEventListener('pointerlockchange', onLockChange)
    client.dispose()
    root.remove()
  }
  return cleanup
}
