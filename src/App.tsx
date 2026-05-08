import { useEffect, useState } from 'react'
import './App.css'

function App() {
  const [ticks, setTicks] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTicks((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <main>
      <h1>Orbital</h1>
      <p className="tagline">idle prototype — wiring up</p>
      <p className="counter">{ticks}</p>
      <p className="hint">tap nothing yet. just checking the pipeline works on your phone.</p>
    </main>
  )
}

export default App
