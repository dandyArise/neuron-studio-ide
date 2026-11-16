import {useLayoutEffect, useRef, useState} from 'react'

export default function Divider({horizontal=false,assistant=false}:{horizontal?:boolean,assistant?:boolean}) {
  const property = assistant ? (horizontal?'--code-height':'--chat-split') : horizontal ? '--live-height' : '--left-width'
  const key = 'neuron.layout.' + property.slice(2)
  const handle = useRef<HTMLDivElement>(null)
  const [percent, setPercent] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(key))
      if (Number.isFinite(saved) && saved >= 20 && saved <= 80) return saved
    } catch { /* Storage may be unavailable in a restricted profile. */ }
    return horizontal ? 64 : 52.38
  })
  useLayoutEffect(() => {
    handle.current?.parentElement?.style.setProperty(property, percent + '%')
  }, [property, percent])
  function resize(value: number) {
    const next = Math.min(80, Math.max(20, value))
    setPercent(next)
    try { localStorage.setItem(key, String(next)) } catch { /* Keep resizing in memory. */ }
  }
  return <div ref={handle} className={assistant ? "chat-divider" : horizontal ? "divider horizontal" : "divider"} role="separator" tabIndex={0}
    aria-label={assistant ? "Séparation code et assistant" : horizontal ? "Hauteur du rendu live" : "Largeur du panneau de rendu"} aria-orientation={horizontal ? "horizontal" : "vertical"}
    aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(percent)}
    onPointerDown={e => {
      if (e.button !== 0) return
      e.preventDefault()
      e.currentTarget.focus()
      e.currentTarget.setPointerCapture(e.pointerId)
    }}
    onPointerMove={e => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
      const box = e.currentTarget.parentElement!.getBoundingClientRect()
      const ratio = horizontal ? (e.clientY-box.top)/box.height : (e.clientX-box.left)/box.width
      resize(100 * ratio)
    }}
    onKeyDown={e => {
      const decrease = horizontal ? 'ArrowUp' : 'ArrowLeft'
      if (e.key !== decrease && e.key !== (horizontal ? 'ArrowDown' : 'ArrowRight')) return
      e.preventDefault()
      resize(percent + (e.key === decrease ? -2 : 2))
    }}/>
}
