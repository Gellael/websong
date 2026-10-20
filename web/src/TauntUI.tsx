import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SPLAT_EMOJI, TAUNTS, TAUNT_EMOJI, type TauntKind, type TauntMsg } from './tauntTypes'
import './taunt.css'

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Satu lemparan: terbang dari avatar pelempar ke avatar target, lalu efek kena. */
function Projectile({
  t,
  name,
  onDone,
}: {
  t: TauntMsg
  name: string
  onDone: (id: string) => void
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [splat, setSplat] = useState<{ x: number; y: number } | null>(null)

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

    const hitClass = `hit-${t.kind}`
    let hitTimer: number | undefined
    let doneTimer: number | undefined

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
      setSplat({ x: tx, y: ty })
      target.classList.add(hitClass)
      hitTimer = window.setTimeout(() => target.classList.remove(hitClass), 950)
      doneTimer = window.setTimeout(() => onDone(t.id), 1200)
    }

    return () => {
      anim.cancel()
      window.clearTimeout(hitTimer)
      window.clearTimeout(doneTimer)
      target.classList.remove(hitClass)
    }
    // satu efek per lemparan; id-nya unik
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (splat) {
    return (
      <span className={`splat splat-${t.kind}`} style={{ left: splat.x, top: splat.y }}>
        <span className="splat-in">
          <i>{SPLAT_EMOJI[t.kind]}</i>
          <b>
            {name} {TAUNT_EMOJI[t.kind]}
          </b>
        </span>
      </span>
    )
  }
  return (
    <span ref={ref} className="proj" style={{ visibility: 'hidden' }}>
      {TAUNT_EMOJI[t.kind]}
    </span>
  )
}

/** Lapisan di atas layar tempat semua lemparan beranimasi. */
export function TauntLayer({
  taunts,
  names,
  onDone,
}: {
  taunts: TauntMsg[]
  names: string[]
  onDone: (id: string) => void
}) {
  // dirender langsung di <body> supaya tidak terpengaruh transform/overflow elemen induk di HP
  return createPortal(
    <div className="taunt-layer" aria-hidden>
      {taunts.map((t) => (
        <Projectile key={t.id} t={t} name={names[t.from] || 'Pemain'} onDone={onDone} />
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