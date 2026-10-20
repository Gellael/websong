import type { TableInfo } from './types'

interface Props {
  tables: TableInfo[]
  loading: boolean
  failed: boolean
  canJoin: boolean
  onJoin: (room: string) => void
}

export function TableList({ tables, loading, failed, canJoin, onJoin }: Props) {
  return (
    <div className="tables">
      <div className="tables-title">Meja tersedia</div>

      {loading ? (
        <p className="hint">Memuat daftar meja…</p>
      ) : failed && tables.length === 0 ? (
        <p className="hint">Daftar meja tidak bisa dimuat. Pakai kode room di bawah.</p>
      ) : tables.length === 0 ? (
        <p className="hint">Belum ada meja terbuka. Buat meja baru atau masukkan kode.</p>
      ) : (
        <ul className="table-list">
          {tables.map((t) => {
            const waiting = t.status === 'waiting'
            const full = t.joined >= 5
            return (
              <li key={t.room} className="table-row">
                <div className="table-info">
                  <b>{t.host || 'Pemain'}</b>
                  <span>
                    {t.room} · {t.scoreLimit > 0 ? `batas ${t.scoreLimit}` : 'tanpa batas'}
                  </span>
                </div>
                <span className={`seatcount ${full ? 'full' : ''}`}>{t.joined}/5</span>
                <button
                  type="button"
                  className="btn sm"
                  disabled={!canJoin || !waiting || full}
                  onClick={() => onJoin(t.room)}
                >
                  {!waiting ? 'Main' : full ? 'Penuh' : 'Gabung'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {!canJoin && tables.length > 0 && <p className="hint">Isi nama dulu untuk bergabung.</p>}
    </div>
  )
}