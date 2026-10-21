# Song

Game kartu multiplayer berbasis web untuk 5 pemain. Dimainkan langsung di browser, dengan aturan permainan ditulis dalam Rust dan antarmuka dalam React.

## Fitur

- Multiplayer real-time lewat WebSocket, masuk ke room dengan kode room
- Minimal 2 pemain; kursi kosong diisi bot, dan pemain yang keluar digantikan bot
- Batas skor bisa dipilih (preset atau angka sendiri, bawaan 200)
- Aturan permainan satu sumber (`song-core`) yang dipakai server Rust maupun Cloudflare Worker (lewat WebAssembly)
- Sound effect kartu dan musik latar, bisa dimatikan

## Aturan singkat

- Dek berisi 2 pack kartu lengkap (104) ditambah 4 joker, total 108 kartu
- Tiap pemain dapat 20 kartu, dan 8 kartu sisanya menjadi kartu mati
- **Fase pembuka:** semua pemain menurunkan satu seri pertama secara tersembunyi, lalu dibuka bersamaan
- **Seri:** 3 sampai 5 kartu berurutan dengan jenis (suit) yang sama. As bisa bernilai 1 atau 14
- **Menyambung:** seri di meja bisa disambung 1 atau 2 kartu di ujung bawah atau atas
- **Kartu mati:** 3 sampai 5 kartu seangka (jenis bebas). Joker boleh mengisi, minimal satu kartu asli
- **Revive:** joker di set kartu mati bisa ditukar dengan kartu asli dari tangan
- **Skor:** pemain yang mati mendapat skor maksimal 75, dan yang mati di awal (tidak bisa membuka seri) mendapat 100. Hasil ronde bisa berupa Song, Leng (menghabiskan kartu dengan menyambung seri, pemenang -50), atau semua pemain mati

Detail lengkap ada di kode, terutama `crates/song-core/src/game.rs` dan `series.rs`.

## Struktur proyek

```
song/
├── crates/
│   ├── song-core/     # aturan game, validasi seri, skor, bot
│   ├── song-server/   # server Rust (axum + WebSocket), alternatif self-host
│   └── song-wasm/     # song-core dikompilasi ke WebAssembly untuk Worker
├── worker/            # Cloudflare Worker + Durable Object (SongRoom)
├── web/               # frontend React + TypeScript + Vite
│   ├── public/audio/  # file mp3 (lihat bagian Audio)
│   └── src/
│       ├── App.tsx            # halaman masuk / pilih room
│       ├── Game.tsx           # tampilan permainan
│       ├── CardView.tsx       # komponen kartu
│       ├── useGameSocket.ts   # koneksi WebSocket
│       ├── sound.ts           # semua logika suara
│       └── MusicToggle.tsx    # tombol musik
├── Dockerfile         # image untuk song-server
└── Cargo.toml         # workspace Rust
```

## Menjalankan secara lokal

Butuh [Node.js](https://nodejs.org) dan [Rust](https://rustup.rs).

**1. Jalankan server (terminal pertama)**

```bash
cargo run -p song-server
```

Server berjalan di port `3001` (ubah dengan variabel `PORT`). Cek kesehatan di `http://localhost:3001/health`.

**2. Jalankan frontend (terminal kedua)**

```bash
cd web
npm install
npm run dev
```

Buka alamat yang tampil di terminal. Vite meneruskan `/ws` ke `ws://localhost:3001`, jadi tidak perlu konfigurasi tambahan.

## Audio

Taruh tiga file mp3 di `web/public/audio/` dengan nama persis berikut:

| File | Dipakai saat |
| --- | --- |
| `card-hover-sound-effect.mp3` | kursor melewati kartu |
| `card-picked-sound-effect.mp3` | kartu dipasang ke meja |
| `card-background-music.mp3` | musik latar (looping) |

**Perilaku**

- Musik mulai setelah klik atau ketukan pertama, karena browser memblokir suara otomatis
- Tombol musik menyalakan atau mematikan musik, dan pilihannya tersimpan di browser (`localStorage`)
- Musik berhenti saat tab disembunyikan dan lanjut saat tab dibuka lagi
- Efek hover dilewati di layar sentuh agar tidak bunyi dobel saat tap

**Dua mode suara**

`sound.ts` mendukung dua sumber suara:

- `mp3`: memakai file di atas (bawaan)
- `synth`: suara disintesis lewat Web Audio API, tanpa file

Mode diganti lewat `soundMode.toggle()` atau `soundMode.set('mp3' | 'synth')`. Contoh tombol di React:

```tsx
import { useSyncExternalStore } from 'react'
import { soundMode } from './sound'

function SoundModeButton() {
  const mode = useSyncExternalStore(soundMode.subscribe, soundMode.get)
  return (
    <button onClick={soundMode.toggle}>
      {mode === 'mp3' ? 'Mode: MP3' : 'Mode: Sintesis'}
    </button>
  )
}
```

**Mengatur volume**

Ubah konstanta `VOLUME` di bagian atas `web/src/sound.ts`. Skalanya 0 (hening) sampai 1 (maksimal), dan berlaku untuk mode `mp3`.

```ts
const VOLUME = { hover: 0.35, picked: 0.7, music: 0.25 }
```

