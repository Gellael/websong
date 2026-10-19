import { useGameSocket } from './useGameSocket'

export default function App() {
  const { connected, messages, send } = useGameSocket()

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Song</h1>
      <p>Status: {connected ? 'Terhubung' : 'Terputus'}</p>
      <button onClick={() => send('halo')}>Kirim "halo"</button>
      <ul>
        {messages.map((m, i) => (
          <li key={i}>
            <code>{m}</code>
          </li>
        ))}
      </ul>
    </div>
  )
}