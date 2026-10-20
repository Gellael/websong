import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TAUNTS, TAUNT_EMOJI, type TauntKind, type TauntMsg } from './tauntTypes'
import './taunt.css'

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Satu lemparan: proyektil terbang dari avatar pelempar ke avatar target.
 * Efek kena TIDAK digambar di sini: setelah mendarat, onHit memberi tahu Game,
 * dan avatar target sendiri yang menampilkannya (menempel di avatar, jadi posisinya selalu tepat).
 */
function Projectile({
  t,
  onHit,
  onDone,
}: {
  t: TauntMsg
  onHit: (t: TauntMsg) => void
  onDone: (id: string) => void
}) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = ref.current
    const target = document.querySelector<HTMLElement>(`[data-seat="${t.to}"]`)
    if (!el || !target) {
      onDone(t.id) // target tidak terlihat di layar ini
      return
    }
    const source = document.querySelector<HTMLElement>(`[data-seat="${t.from}"]`)
    const rt = target.getBoundingClientRect()
    const rs = source?.getBoundingClientRect()

    const tx = rt.left + rt.width / 2
    const ty = rt.top + rt.height / 2
    const sx = rs ? rs.left + rs.width / 2 : window.innerWidth / 2
    const sy = rs ? rs.top + rs.height / 2 : window.innerHeight + 30
    const mx = (sx + tx) / 2
    const my = Math.min(sy, ty) - 90

    el.style.visibility = 'visible'
    const anim = el.animate(
      [
        { transform: `translate(${sx}px, ${sy}px) translate(-50%, -50%) scale(.6) rotate(0deg)` },
        {
          transform: `translate(${mx}px, ${my}px) translate(-50%, -50%) scale(1.35) rotate(360deg)`,
          offset: 0.5,
        },
        { transform: `translate(${tx}px, ${ty}px) translate(-50%, -50%) scale(1) rotate(720deg)` },
      ],
      {
        duration: prefersReducedMotion() ? 120 : 750,
        easing: 'cubic-bezier(.3,.1,.6,1)',
        fill: 'forwards',
      },
    )

    anim.onfinish = () => {
      onHit(t)
      onDone(t.id)
    }

    return () => anim.cancel()
    // satu efek per lemparan; id-nya unik
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <span ref={ref} className="proj" style={{ visibility: 'hidden' }}>
      {TAUNT_EMOJI[t.kind]}
    </span>
  )
}

/** Lapisan di atas layar tempat proyektil beranimasi. */
export function TauntLayer({
  taunts,
  onHit,
  onDone,
}: {
  taunts: TauntMsg[]
  onHit: (t: TauntMsg) => void
  onDone: (id: string) => void
}) {
  // dirender langsung di <body> supaya tidak terpengaruh transform/overflow elemen induk di HP
  return createPortal(
    <div className="taunt-layer" aria-hidden>
      {taunts.map((t) => (
        <Projectile key={t.id} t={t} onHit={onHit} onDone={onDone} />
      ))}
    </div>,
    document.body,
  )
}

/** Tombol 🎯 di pojok kanan bawah: pilih senjata, lalu ketuk pemain yang mau dilempar. */
export function TauntTray({
  weapon,
  cooling,
  onPick,
}: {
  weapon: TauntKind | null
  cooling: boolean
  onPick: (k: TauntKind | null) => void
}) {
  const [open, setOpen] = useState(false)

  return createPortal(
    <div className="taunt-tray">
      {weapon && (
        <p className="taunt-hint">{cooling ? 'Tunggu sebentar…' : 'Ketuk pemain yang mau dilempar'}</p>
      )}
      {open && (
        <div className="taunt-menu">
          {TAUNTS.map((w) => (
            <button
              type="button"
              key={w.kind}
              title={w.label}
              aria-label={w.label}
              className={`taunt-btn ${weapon === w.kind ? 'on' : ''}`}
              onClick={() => onPick(weapon === w.kind ? null : w.kind)}
            >
              {w.emoji}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className={`taunt-fab ${open ? 'on' : ''}`}
        aria-label="Lempar sesuatu"
        onClick={() => {
          if (open) onPick(null)
          setOpen(!open)
        }}
      >
        {weapon ? TAUNT_EMOJI[weapon] : '🎯'}
      </button>
    </div>,
    document.body,
  )
}