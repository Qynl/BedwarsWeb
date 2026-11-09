import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three'
import type { TeamId } from '../blocks'
import { CAPES, DEFAULT_LOOK, decodeLook, encodeLook, EYE_COLORS, HAIR_COLORS, HAIR_STYLES, KILL_EFFECTS, OUTFIT_COLORS, OUTFITS, randomLook, SKIN_TONES, TRAILS, type Look } from '../look'
import { Avatar } from './avatar'
import { buyCosmetic, cosmeticPrice, isUnlocked, levelInfo, loadProfile, saveProfile, type CosmeticField } from './profile'

const STORAGE_KEY = 'look'

export function loadLook(): Look {
  try {
    return decodeLook(localStorage.getItem(STORAGE_KEY) ?? encodeLook(DEFAULT_LOOK))
  } catch {
    return { ...DEFAULT_LOOK }
  }
}

export function saveLook(look: Look): void {
  try {
    localStorage.setItem(STORAGE_KEY, encodeLook(look))
  } catch {}
}

/**
 * The wardrobe: a turning preview of your figure and a row of choices for each
 * part of your look. Every change is saved and handed to `onChange` at once.
 */
export function openWardrobe(host: HTMLElement, team: TeamId | null, onChange: (look: Look) => void, onClose: () => void): () => void {
  let look = loadLook()
  let profile = loadProfile()
  let note = ''
  const overlay = document.createElement('div')
  overlay.className = 'modal show settings-overlay'
  host.append(overlay)

  const renderer = new WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
  renderer.setSize(240, 320)
  renderer.outputColorSpace = SRGBColorSpace
  const scene = new Scene()
  scene.add(new AmbientLight(0xffffff, 1.4))
  const sun = new DirectionalLight(0xffffff, 1.6)
  sun.position.set(1, 2, -2)
  scene.add(sun)
  const camera = new PerspectiveCamera(35, 240 / 320, 0.1, 50)
  camera.position.set(0, 1.1, -4.2)
  camera.lookAt(0, 0.95, 0)
  const avatar = new Avatar()
  scene.add(avatar.root)
  let angle = Math.PI + 0.5
  let dragging = false
  let lastX = 0
  let running = true
  let t = 0
  const loop = () => {
    if (!running) return
    requestAnimationFrame(loop)
    if (!dragging) angle += 0.006
    t += 1 / 60
    avatar.root.rotation.y = angle
    // A gentle walk so the cape and trail choices read.
    avatar.animate(1 / 60, { sneak: false, swing: 20, hurt: 20, shield: false, pitch: 0, speed: 2.5 + Math.sin(t) * 1.5, vy: 0 })
    renderer.render(scene, camera)
  }

  const swatches = (key: keyof Look, colors: string[]) =>
    `<div class="swatches">${colors.map((c, i) => `<button class="swatch${look[key] === i ? ' chosen' : ''}" style="background:${c}" data-pick="${key}" data-value="${i}" aria-label="${key} ${i + 1}"></button>`).join('')}</div>`
  const buttons = (key: keyof Look, names: readonly string[], field?: CosmeticField) =>
    `<div class="choice wrap">${names
      .map((n, i) => {
        const owned = field ? isUnlocked(profile, field, i) : true
        const price = field ? cosmeticPrice(field, i) : 0
        return `<button class="btn small-btn${look[key] === i ? ' chosen' : ''}${owned ? '' : ' locked'}" data-pick="${key}" data-value="${i}"${owned ? '' : ` data-buy-field="${field}"`}>${n}${owned ? '' : `<span class="price">${price}</span>`}</button>`
      })
      .join('')}</div>`
  const row = (label: string, body: string) => `<div class="setting"><div><b>${label}</b></div>${body}</div>`
  /** A random choice the player already owns, so "Surprise me" never equips something locked. */
  const ownedRandom = (field: CosmeticField, count: number) => {
    const options = Array.from({ length: count }, (_, i) => i).filter((i) => isUnlocked(profile, field, i))
    return options[Math.floor(Math.random() * options.length)] ?? 0
  }

  function render() {
    overlay.innerHTML = `<div class="window settings-window wardrobe">
      <div class="window-head"><h2>Wardrobe</h2><button class="btn ghost" data-close>Done</button></div>
      <div class="profile-strip"><span><b>Level ${levelInfo(profile.xp).level}</b> · ${profile.shards} shards</span><span class="muted small">Earn shards in arena rounds</span></div>
      <div class="wardrobe-body">
        <div class="preview"></div>
        <div class="settings-body">
          <p class="note">${note || 'Locked items cost shards; click one to buy and wear it.'}</p>
          ${row('Skin', swatches('skin', SKIN_TONES))}
          ${row('Hair', buttons('hairStyle', HAIR_STYLES))}
          ${row('Hair colour', swatches('hairColor', HAIR_COLORS))}
          ${row('Eyes', swatches('eyes', EYE_COLORS))}
          ${row('Outfit', buttons('outfit', OUTFITS))}
          ${row('Outfit colour', swatches('outfitColor', OUTFIT_COLORS))}
          ${row('Cape', buttons('cape', CAPES, 'cape'))}
          ${row('Trail', buttons('trail', TRAILS, 'trail'))}
          ${row('Kill effect', buttons('killEffect', KILL_EFFECTS, 'killEffect'))}
        </div>
      </div>
      <div class="row"><button class="btn" data-random>Surprise me</button><p class="muted small">Your team colour shows on your armour, armbands and team cape.</p></div>
    </div>`
    overlay.querySelector('.preview')!.append(renderer.domElement)
    overlay.querySelector('[data-close]')!.addEventListener('click', close)
    overlay.querySelector('[data-random]')!.addEventListener('click', () => {
      const next = randomLook()
      next.cape = ownedRandom('cape', CAPES.length)
      next.trail = ownedRandom('trail', TRAILS.length)
      next.killEffect = ownedRandom('killEffect', KILL_EFFECTS.length)
      update(next)
    })
    overlay.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) =>
      b.addEventListener('click', () => {
        const field = b.dataset.buyField as CosmeticField | undefined
        const index = Number(b.dataset.value)
        if (field && !isUnlocked(profile, field, index)) {
          const price = cosmeticPrice(field, index)
          const bought = buyCosmetic(profile, field, index)
          if (!bought) {
            note = `Need ${price} shards for that.`
            render()
            return
          }
          profile = bought
          saveProfile(profile)
          note = `Unlocked for ${price} shards.`
        }
        update({ ...look, [b.dataset.pick as keyof Look]: index })
      }),
    )
    const canvas = renderer.domElement
    canvas.onpointerdown = (e) => {
      dragging = true
      lastX = e.clientX
      canvas.setPointerCapture(e.pointerId)
    }
    canvas.onpointermove = (e) => {
      if (!dragging) return
      angle += (e.clientX - lastX) * 0.012
      lastX = e.clientX
    }
    canvas.onpointerup = () => (dragging = false)
  }

  function update(next: Look) {
    look = next
    saveLook(look)
    avatar.dress(look, team, 'leather')
    onChange(look)
    render()
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Escape') return
    e.preventDefault()
    e.stopImmediatePropagation()
    close()
  }
  window.addEventListener('keydown', onKey, true)
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close()
  })

  let closed = false
  function close() {
    if (closed) return
    closed = true
    running = false
    window.removeEventListener('keydown', onKey, true)
    avatar.dispose()
    renderer.dispose()
    overlay.remove()
    onClose()
  }

  avatar.dress(look, team, 'leather')
  render()
  loop()
  return close
}
