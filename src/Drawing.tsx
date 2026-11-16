import {useEffect, useState} from 'react'

export type Drawing = {svg: string} | {png: string}

export function parseDrawing(line: string): Drawing | null {
  if (!line.startsWith('@live ') || line.length > 2097152) return null
  try {
    const data = JSON.parse(line.slice(6))
    if (typeof data?.svg === 'string' && data.svg.trim()) return {svg: data.svg}
    if (typeof data?.png === 'string' && data.png.startsWith('iVBORw0KGgo') && /^[\w+/=]+$/.test(data.png)) return {png: data.png}
  } catch { /* Ordinary output stays visible in the console. */ }
  return null
}

export default function DrawingView({drawing}: {drawing: Drawing | null}) {
  const [url,setUrl] = useState('')
  const [failed,setFailed] = useState('')
  useEffect(() => {
    if (!drawing) { setUrl(''); return }
    if ('png' in drawing) { setUrl('data:image/png;base64,' + drawing.png); return }
    // Use an image document: script markup never becomes part of the IDE DOM.
    const objectUrl = URL.createObjectURL(new Blob([drawing.svg], {type:'image/svg+xml'}))
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [drawing])
  if (!drawing) return <p className="drawing-hint">Le dessin envoyé par votre script Python apparaîtra ici.</p>
  return <>{url && <img className="drawing-image" src={url} alt="Dessin du script Python" onError={()=>setFailed(url)}/>}
    {url && failed===url && <p className="drawing-hint">Image illisible. Vérifiez le SVG ou le PNG envoyé par le script.</p>}</>
}

