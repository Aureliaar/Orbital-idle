// Entry shell for "The Show". Mounts PageChrome once, runs a single
// requestAnimationFrame accumulator at 4 Hz, and switches between the
// three stage views. State is held by useState; this is the
// "read-only sim" cut — heat / attention / cycles / stocks / windows
// advance but no interaction beyond tab switching is wired yet.

import { useEffect, useReducer, useRef, useState } from 'react'
import './App.css'
import { PageChrome } from './PageChrome'
import { ShowCrown, StageTabs, type Tab } from './show/Crown'
import { PitStage } from './show/PitStage'
import { ResearchStage } from './show/ResearchStage'
import { WheelStage } from './show/WheelStage'
import {
  BEAT_MS,
  buyUpgrade,
  initialState,
  relightStation,
  swapSlotRecipe,
  tendStation,
  tickBeat,
  type ShowState,
} from './show/state'
import type { UpgradeId } from './show/data'

export type ShowAction =
  | { type: 'beat' }
  | { type: 'tend'; station: number }
  | { type: 'relight'; station: number }
  | { type: 'swap'; station: number; slot: number }
  | { type: 'buy'; upgrade: UpgradeId }
function reducer(state: ShowState, action: ShowAction): ShowState {
  switch (action.type) {
    case 'beat':
      return tickBeat(state)
    case 'tend':
      return tendStation(state, action.station)
    case 'relight':
      return relightStation(state, action.station)
    case 'swap':
      return swapSlotRecipe(state, action.station, action.slot)
    case 'buy':
      return buyUpgrade(state, action.upgrade)
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>('pit')
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  const lastRef = useRef<number | null>(null)
  const accRef = useRef(0)

  useEffect(() => {
    let raf = 0
    const loop = (now: number) => {
      if (lastRef.current == null) lastRef.current = now
      const dt = now - lastRef.current
      lastRef.current = now
      accRef.current += dt
      while (accRef.current >= BEAT_MS) {
        accRef.current -= BEAT_MS
        dispatch({ type: 'beat' })
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <main className="show">
      <PageChrome />
      <div className="show-inner">
        <ShowCrown
          tab={tab}
          act={state.act}
          scene={state.scene}
          bar={state.bar}
          attention={state.attention}
        />
        <StageTabs active={tab} onChange={setTab} />
        <div className="show-body">
          {tab === 'pit' && <PitStage state={state} dispatch={dispatch} />}
          {tab === 'wheel' && <WheelStage state={state} />}
          {tab === 'research' && <ResearchStage state={state} />}
        </div>
      </div>
    </main>
  )
}
