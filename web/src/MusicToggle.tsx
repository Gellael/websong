import { useSyncExternalStore } from 'react'
import { music } from './audio'

interface Props {
  /** true = melayang di pojok kanan atas (lobby, ruang tunggu, hasil akhir). false = sebaris di topbar. */
  floating?: boolean
}

export function MusicToggle({ floating }: Props) {
  const on = useSyncExternalStore(music.subscribe, music.isOn)
  return (
    <button
      type="button"
      className={`music-toggle ${floating ? 'floating' : 'roomtag'} ${on ? 'on' : 'off'}`}
      onClick={music.toggle}
      aria-pressed={on}
      aria-label={on ? 'Matikan musik' : 'Nyalakan musik'}
      title={on ? 'Matikan musik' : 'Nyalakan musik'}
    >
      {on ? '🔊' : '🔇'}
      {!floating && <span> Musik</span>}
    </button>
  )
}
