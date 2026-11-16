import {useEffect,useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Channel,invoke,isTauri} from '@tauri-apps/api/core'
import {getCurrentWindow} from '@tauri-apps/api/window'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import {Terminal} from '@xterm/xterm'
import {FitAddon} from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import Live,{parseFrame,type Frame} from './Live'
import demo from './demo.py?raw'
import {splitOutput} from './stream'
import './style.css'
import './layout.css'
import Divider from './Divider'
import Preferences,{loadLlm,type Section} from './Preferences'
import {applyAppearance,loadAppearance} from './appearance'
import Assistant,{type Crash} from './Assistant'
import {installCompletion} from './completion'
import DrawingView,{parseDrawing,type Drawing} from './Drawing'

self.MonacoEnvironment = {getWorker: () => new EditorWorker()}
type Output = {kind:'stdout'|'stderr',data:string}|{kind:'exit',code:number|null,stopped:boolean}
type Doc = {name:string,content:string}
function App(){
  const [name,setName]=useState('neural_network.py'), [dirty,setDirty]=useState(false)
  const [state,status]=useState('Prêt'),[running,setRunning]=useState(false),[busy,setBusy]=useState(false)
  const [frame,setFrame]=useState<Frame|null>(null),[position,setPosition]=useState('1 : 1')
  const [samples,setSamples]=useState<Frame[]>([])
  const [drawing,setDrawing]=useState<Drawing|null>(null)
  const sourceHost=useRef<HTMLDivElement>(null),outputHost=useRef<HTMLDivElement>(null)
  const editor=useRef<monaco.editor.IStandaloneCodeEditor|null>(null),term=useRef<Terminal|null>(null)
  const baseline=useRef(demo),active=useRef(false),locked=useRef(false)
  const [auto,setAuto]=useState(false)
  const autoEnabled=useRef(false), pendingRun=useRef(false)
  const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined)
  const actions=useRef({run:()=>{},save:()=>{},open:()=>{},newFile:()=>{}})
  function toggleAuto(enabled:boolean){
    clearTimeout(timer.current)
    pendingRun.current=false
    autoEnabled.current=enabled
    setAuto(enabled)
    if(enabled && !active.current) scheduleAuto()
  }
  function scheduleAuto(){
    if(!autoEnabled.current)return
    clearTimeout(timer.current)
    pendingRun.current=false
    timer.current=setTimeout(()=>{
      if(!autoEnabled.current)return
      if(locked.current){scheduleAuto();return}
      if(active.current){
        pendingRun.current=true
        void invoke('stop').catch(e=>{pendingRun.current=false;failure(e)})
      }else actions.current.run()
    },700)
  }
  useEffect(()=>{
    monaco.editor.defineTheme('neuron',{base:'vs-dark',inherit:true,rules:[
      {token:'keyword',foreground:'D69F6F'},{token:'comment',foreground:'84887C',fontStyle:'italic'},
      {token:'string',foreground:'AEC49A'},{token:'number',foreground:'A8CBBD'}],
      colors:{'editor.background':'#121311','editorLineNumber.foreground':'#60625B','editor.lineHighlightBackground':'#1C1D19','editorCursor.foreground':'#E2AD77'}})
    const ed=monaco.editor.create(sourceHost.current!,{value:demo,language:'python',theme:'neuron',automaticLayout:true,minimap:{enabled:false},fontFamily:'Cascadia Code, Consolas, monospace',fontSize:14,lineHeight:23,padding:{top:14},scrollBeyondLastLine:false,tabSize:4,lineNumbersMinChars:3})
    ed.updateOptions({fixedOverflowWidgets:true})
    editor.current=ed
    const completion=installCompletion(ed)
    ed.onDidChangeModelContent(()=>{setDirty(ed.getValue()!==baseline.current);scheduleAuto()})
    ed.onDidChangeCursorPosition(e=>setPosition(e.position.lineNumber+' : '+e.position.column))
    const t=new Terminal({theme:{background:'#10110f',foreground:'#deded2'},disableStdin:true,convertEol:true,scrollback:2500,fontSize:13,fontFamily:'Consolas, monospace'})
    const fit=new FitAddon();t.loadAddon(fit);t.open(outputHost.current!);term.current=t
    const observer=new ResizeObserver(([entry])=>{if(entry.contentRect.width && entry.contentRect.height)fit.fit()});observer.observe(outputHost.current!)
    fitRef.current=fit
    function keys(e:KeyboardEvent){
      if(e.ctrlKey && e.key===','){e.preventDefault();setSection('appearance');return}
      if(document.querySelector('dialog[open]'))return
      if(e.key==='F5'){e.preventDefault();actions.current.run()}
      if(e.ctrlKey && e.key.toLowerCase()==='n'){e.preventDefault();actions.current.newFile()}
      if(e.ctrlKey && ['s','o'].includes(e.key.toLowerCase())){e.preventDefault();if(e.key.toLowerCase()==='s')actions.current.save();else actions.current.open()}
    }
    window.addEventListener('keydown',keys,true)
    const close=isTauri()?getCurrentWindow().onCloseRequested(async e=>{
      if(ed.getValue()!==baseline.current){e.preventDefault();if(window.confirm('Fermer et abandonner les modifications ?'))await getCurrentWindow().destroy()}
    }):null
    return ()=>{clearTimeout(timer.current);completion.dispose();void close?.then(fn=>fn());observer.disconnect();window.removeEventListener('keydown',keys,true);ed.dispose();t.dispose()}
  },[])
  const [assistant,setAssistant]=useState(false),[consoleOpen,setConsoleOpen]=useState(true)
  const [assistantStarted,startAssistant]=useState(false)
  const [crash,setCrash]=useState<Crash|null>(null),[explain,setExplain]=useState<Crash|null>(null)
  const [asking,setAsking]=useState(false)
  const [attachment,setAttachment]=useState<{text:string}|null>(null)
  function attachConsole(){
    const terminal=term.current
    if(!terminal)return
    terminal.write('',()=>{
      const buffer=terminal.buffer.active
      let text=''
      for(let i=buffer.length-1;i>=0 && text.length<=24000;i--){
        const line=buffer.getLine(i)
        if(line)text=line.translateToString(!buffer.getLine(i+1)?.isWrapped)+(buffer.getLine(i+1)?.isWrapped?'':'\n')+text
      }
      text=text.trimEnd()
      if(!text){status('La console est vide');return}
      setAttachment({text:text.length>24000?'[… début de la sortie omis …]\n'+text.slice(-24000):text})
      startAssistant(true);setAssistant(true)
    })
  }
  const fitRef=useRef<FitAddon|null>(null)
  const [appearance,setAppearance]=useState(loadAppearance),[config,setConfig]=useState(loadLlm)
  const [section,setSection]=useState<Section|null>(null)
  useEffect(()=>{
    applyAppearance(appearance,editor.current,term.current)
    if(outputHost.current?.clientWidth)fitRef.current?.fit()
  },[appearance])
  function failure(e:unknown){status('Erreur');term.current?.writeln('\r\n\x1b[31m'+String(e)+'\x1b[0m')}
  async function file(action:'new'|'open'|'save', proposedCode?:string){
    const save=action==='save'
    if(locked.current||active.current||!editor.current)return
    if(!save && editor.current.getValue()!==baseline.current && !confirm('Abandonner les modifications du document actuel ?'))return
    locked.current=true;setBusy(true)
    const ed=editor.current,content=ed.getValue()
    try{
      if(save){const n=await invoke<string|null>('save_file',{content});if(n){baseline.current=content;setDirty(ed.getValue()!==content);setName(n)}}
      else {
        const doc=await invoke<Doc|null>(action==='new'?'new_file':'open_file')
        if(doc){
          setCrash(null)
          toggleAuto(false);baseline.current=doc.content;ed.setValue(proposedCode??doc.content);setDirty(ed.getValue()!==doc.content);setName(doc.name)
          setFrame(null);setDrawing(null);setSamples([]);term.current?.reset();status('Prêt');ed.focus()
          if(proposedCode!==undefined){
            locked.current=false
            await run()
          }
        }
      }
    }catch(e){failure(e)}finally{locked.current=false;setBusy(false)}
  }
  async function run(){
    if(active.current||locked.current||!editor.current)return
    clearTimeout(timer.current);pendingRun.current=false
    active.current=true;setRunning(true);setFrame(null);setDrawing(null);setSamples([]);status('En cours')
    const terminal=term.current!;terminal.reset()
    setCrash(null)
    const source=editor.current.getValue(),version=editor.current.getModel()!.getVersionId()
    let stderr=''
    const output=splitOutput(s=>terminal.write(s),line=>{
      const scene=parseDrawing(line)
      if(scene){setDrawing(scene);setFrame(null);setSamples(previous=>previous.length?[]:previous);return true}
      const next=parseFrame(line)
      if(next){setFrame(next);setSamples(previous=>[...previous.slice(-11),next])}
      return !!next
    })
    const events=new Channel<Output>()
    events.onmessage=e=>{
      if(e.kind==='exit'){
        output.finish()
        const label=e.stopped?'Arrêté':('Code de sortie '+(e.code??'inconnu'))
        if(!e.stopped&&e.code!==0)setCrash({source,version,diagnostic:stderr.trim()?stderr+'\n'+label:label})
        status(label);terminal.writeln('\r\n\x1b[90m'+label+'\x1b[0m')
        active.current=false;setRunning(false)
        if(pendingRun.current && autoEnabled.current)actions.current.run()
      }else if(e.kind==='stdout')output.push(e.data)
      else {stderr=(stderr+e.data).slice(-32000);terminal.write('\x1b[31m'+e.data+'\x1b[0m')}
    }
    try{await invoke('run',{source,events})}catch(e){active.current=false;setRunning(false);failure(e)}
  }
  async function stop(){toggleAuto(false);if(!active.current)return;status('Arrêt demandé');try{await invoke('stop')}catch(e){failure(e)}}
  actions.current={run,save:()=>file('save'),open:()=>file('open'),newFile:()=>file('new')}
  return <main><header><div className="brand"><span className="brandmark">N</span>Neuron<span className="studio">Studio</span></div><nav>

    <button title="Nouveau fichier Python (Ctrl+N)" disabled={running||busy} onClick={()=>file('new')}>Nouveau</button>
    <button disabled={running||busy} onClick={()=>file('open')}>Ouvrir</button><button disabled={running||busy} onClick={()=>file('save')}>Enregistrer</button><i/>
    <button disabled={busy} aria-pressed={auto} title="Relancer après 700 ms sans frappe" onClick={()=>toggleAuto(!autoEnabled.current)}>Run auto {auto?'✓':''}</button>
    <button disabled={!running&&!auto} onClick={stop}>■ Stop</button><button className="execute" disabled={running||busy} onClick={run}>▶ Exécuter</button></nav></header>
    <div className={'workspace'+(consoleOpen?'':' console-closed')}><section className="visual"><div className="strip"><strong>Rendu live</strong><small>{(drawing||frame)?(running?'● EN DIRECT':'DERNIÈRE IMAGE'):'EN ATTENTE'}</small></div>{frame?<Live frame={frame}/>:<DrawingView drawing={drawing}/>} 
      {samples.length>0 && <div className="samples" aria-label="Derniers échantillons">{samples.map((sample,index)=><svg key={index} viewBox="0 0 5 7" role="img" aria-label={'Chiffre '+sample.label}><title>{'Époque '+sample.epoch+' · chiffre '+sample.label}</title>{sample.pixels.map((v,i)=><rect key={i} x={i%5} y={Math.floor(i/5)} width=".88" height=".88" fill="currentColor" opacity={v}/>)}</svg>)}</div>}
    </section><Divider/><Divider horizontal/>
    <div className="tools"><section className="code"><div className="strip"><strong><em>Py</em> {name}{dirty?' •':''}</strong><small>PYTHON</small></div><div ref={sourceHost} className="editor"/>
    {assistant && <Divider horizontal assistant/>}
    {assistantStarted && <Assistant runCurrent={run} explain={explain} consume={()=>setExplain(null)} reportBusy={setAsking} attachment={attachment} removeAttachment={item=>setAttachment(current=>current===item?null:current)} config={config} settings={()=>setSection('llm')} visible={assistant} editorRef={editor} close={()=>setAssistant(false)} beforeEdit={()=>toggleAuto(false)} runDisabled={running||busy} runNew={code=>void file('new',code)}/>}</section>
    <section className="output"><div className="strip"><strong><em>›_</em> Console</strong><span>
      {crash&&<button disabled={asking||!!explain} onClick={()=>{startAssistant(true);setAssistant(true);setExplain(crash)}}>Expliquer l’erreur</button>}{' '}
      <button onClick={attachConsole}>Joindre à la question</button>{' '}<button type="button" title="Effacer la sortie et son historique" onClick={()=>{term.current?.write('\x1bc');setCrash(null)}}>Vider</button></span></div><div ref={outputHost} className="terminal"/></section></div></div>
    <footer><div className="panel-buttons"><button aria-pressed={assistant} onClick={()=>{startAssistant(true);setAssistant(!assistant)}}>🤖 Assistant</button>
      <button aria-pressed={consoleOpen} onClick={()=>setConsoleOpen(!consoleOpen)}>›_ Console</button>
      <button title="Préférences (Ctrl+,)" onClick={()=>setSection('appearance')}>⚙ Préférences</button>
      <span><b className={running?'on':''}/> {state}</span></div><span>Ln / Col {position}　 ·　 UTF-8　 ·　 Python</span></footer>
    {section&&<Preferences initial={section} appearance={appearance} change={setAppearance} config={config} save={setConfig} close={()=>setSection(null)}/>}</main>
}
createRoot(document.getElementById('root')!).render(<App/>)

