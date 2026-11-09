import { levelInfo, loadProfile, PRICES, type CosmeticField } from './profile'

const COSMETIC_COUNTS: Record<CosmeticField, number> = { cape: 9, trail: 6, killEffect: 4 }
const OWNED_LABEL: Record<CosmeticField, string> = { cape: 'Capes', trail: 'Trails', killEffect: 'Kill effects' }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** The progress window: level, shards, lifetime stats and what still needs buying. */
export function openProfile(host: HTMLElement, onClose: () => void): () => void {
  const profile = loadProfile()
  const level = levelInfo(profile.xp)
  const overlay = document.createElement('div')
  overlay.className = 'modal show settings-overlay'
  host.append(overlay)

  const owned = (field: CosmeticField) => COSMETIC_COUNTS[field] - PRICES[field].filter((p) => p > 0).length + profile.unlocked.filter((k) => k.startsWith(`${field}:`)).length
  const totalOwned = Object.keys(COSMETIC_COUNTS).reduce((n, f) => n + owned(f as CosmeticField), 0)
  const total = Object.values(COSMETIC_COUNTS).reduce((a, b) => a + b, 0)
  const stats: [string, number][] = [
    ['Kills', profile.kills],
    ['Final kills', profile.finals],
    ['Cores shattered', profile.beds],
    ['Wins', profile.wins],
    ['Rounds', profile.games],
  ]

  overlay.innerHTML = `<div class="window settings-window profile-window">
    <div class="window-head"><h2>Progress</h2><button class="btn ghost" data-close>Done</button></div>
    <div class="settings-body">
      <div class="level-strip">
        <div class="level-badge">${level.level}</div>
        <div class="level-body">
          <b>Level ${level.level}</b>
          <div class="level-bar"><i style="width:${Math.max(0, Math.min(100, (level.into / level.need) * 100)).toFixed(1)}%"></i></div>
          <p class="muted small">${level.into} / ${level.need} XP to level ${level.level + 1}</p>
        </div>
        <div class="shard-purse"><b>${profile.shards}</b><span>shards</span></div>
      </div>
      <div class="stat-grid">${stats.map(([label, value]) => `<div><b>${value}</b><span>${label}</span></div>`).join('')}</div>
      <p class="note">Shards are earned in arena rounds: 6 a kill, 14 a final, 35 a shard core, 75 a win. Spend them in the Wardrobe on capes, trails and kill effects.</p>
      <p class="muted small">Unlocked ${totalOwned} of ${total} cosmetics. ${Object.keys(COSMETIC_COUNTS).map((f) => `${OWNED_LABEL[f as CosmeticField]} ${owned(f as CosmeticField)}/${COSMETIC_COUNTS[f as CosmeticField]}`).join(' · ')}</p>
      <p class="muted small">Progress is kept on this device${esc('')}.</p>
    </div>
  </div>`

  const close = () => {
    window.removeEventListener('keydown', onKey, true)
    overlay.remove()
    onClose()
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
  overlay.querySelector('[data-close]')!.addEventListener('click', close)
  return close
}
