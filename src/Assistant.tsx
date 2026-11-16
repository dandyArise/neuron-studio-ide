import {useEffect,useRef,useState} from 'react'
import type {RefObject} from 'react'
import type {editor,Selection} from 'monaco-editor'
import {Channel,invoke} from '@tauri-apps/api/core'
import ChatReply from './ChatReply'
import './assistant.css'

import type {LlmConfig} from './Preferences'
import {effortLabels,reasoningOptions,type LocalModel} from './reasoning'
const dockOptions = [['bottom','Chat en bas'],['left','Chat à gauche'],['right','Chat à droite']] as const
type Props = {compare:(before:string,after:string,apply:()=>void)=>void,dock:string,setDock:(position:'bottom'|'left'|'right')=>void,config:LlmConfig,chooseModel:(id:string)=>void,visible:boolean, editorRef:RefObject<editor.IStandaloneCodeEditor|null>, close:()=>void, beforeEdit:()=>void, runDisabled:boolean}
type Target = {version:number, range:Selection}
type Turn = {question:string,context:string,answer:string,target:Target,correction?:string,consoleText?:string}
type Attachment={text:string}
export type Crash={source:string,diagnostic:string,version:number}
function codeAttachment(ed:editor.IStandaloneCodeEditor|null,scope:LlmConfig['scope']){
  const doc=ed?.getModel(), range=ed?.getSelection()
  if(!doc||!range||scope==='none')return {label:'Aucun code joint',code:''}
  if(scope!=='file'&&!range.isEmpty())return {
    label:`Sélection jointe · L${range.startLineNumber}–${range.endLineNumber}`,code:doc.getValueInRange(range)
  }
  if(scope==='selection')return {label:'Sélectionnez du code à joindre',code:''}
  return {label:doc.getValueLength()?'Script ouvert joint':'Script ouvert vide',code:doc.getValue()}
}
export default function Assistant({compare,dock,setDock,chooseModel,explain,consume,reportBusy,attachment,removeAttachment,config,visible,editorRef,close,beforeEdit,runDisabled}:Props & {explain:Crash|null,consume:()=>void,reportBusy:(busy:boolean)=>void,attachment:Attachment|null,removeAttachment:(item:Attachment)=>void}){
  const {provider,scope,model,port}=config
  const [,refreshCode]=useState(0)
  const ed=editorRef.current
  useEffect(()=>{
    if(!visible||!ed)return
    const refresh=()=>refreshCode(n=>n+1)
    const listeners=[ed.onDidChangeCursorSelection(refresh),ed.onDidChangeModelContent(refresh),ed.onDidChangeModel(refresh)]
    return ()=>listeners.forEach(listener=>listener.dispose())
  },[visible,ed])
  const joined=codeAttachment(ed,scope)
  const [question,setQuestion]=useState(''),[error,setError]=useState('')
  const [threads,setThreads]=useState<Record<string,Turn[]>>({})
  const turns=threads[provider]??[]
  const [sent,setSent]=useState('')
  const [partial,setPartial]=useState('')
  const [connection,setConnection]=useState(''),[models,setModels]=useState<LocalModel[]>([])
  const levels=reasoningOptions(models,model)
  const [effort,setEffort]=useState(config.effort||'')
  const [pendingConsole,setPendingConsole]=useState<string>()
  useEffect(()=>setEffort(config.effort||''),[model,port,config.effort])
  useEffect(()=>{
    let current=true
    setConnection('');setModels([])
    if(!visible||provider!=='lmstudio')return
    invoke<LocalModel[]>('assistant_models',{port}).then(models=>{
      if(!current)return
      setConnection('connecté')
      setModels(models)
    }).catch(()=>{if(current)setConnection('indisponible')})
    return ()=>{current=false}
  },[provider,port,model,visible,config])
  function review(turn:Turn,correction=turn.correction){
    const doc=editorRef.current?.getModel()
    if(!doc||!correction)return
    const target={...turn.target,version:doc.getVersionId()}
    compare(doc.getValue(),correction,()=>insert(correction,target,true))
  }
  const log=useRef<HTMLDivElement>(null)
  useEffect(()=>{
    if(visible && log.current)log.current.scrollTop=log.current.scrollHeight
  },[visible,threads,sent,partial,provider])
  const [waiting,setWaiting]=useState(false)
  const inFlight=useRef(false)
  useEffect(()=>{
    if(explain&&!inFlight.current){consume();void ask(explain)}
  },[explain,waiting])
  async function ask(crash?:Crash){
    const ed=editorRef.current,doc=ed?.getModel(),range=ed?.getSelection()
    if(!doc||!range||inFlight.current||(!crash&&!question.trim()))return
    const {code}=codeAttachment(ed,scope)
    if(!crash&&scope==='selection'&&!code){setError('Sélectionnez du code dans l’éditeur.');return}
    const context=crash?crash.source+'\n\nErreur de cette exécution :\n'+crash.diagnostic:[code,attachment&&'Sortie console :\n'+attachment.text].filter(Boolean).join('\n\n')
    const number=Number(port)
    if(provider==='lmstudio'&&(!Number.isInteger(number)||number<1||number>65535)){setError('Port invalide.');return}
    const target={version:crash?.version??doc.getVersionId(),range}, prompt=crash?'Explique la cause de cette erreur et indique la ligne concernée. Fournis ensuite le script Python complet corrigé dans un seul bloc Markdown python. Conserve toutes les autres fonctionnalités.':question.trim()
    reportBusy(true)
    const consoleText=crash?.diagnostic??attachment?.text
    setPendingConsole(consoleText)
    if(!crash)setQuestion('')
    inFlight.current=true;setWaiting(true);setError('');setSent(prompt)
    try{
      const history=turns.slice(-12).map(({question,context,answer})=>({question,context,answer}))
      const events=new Channel<string>()
      events.onmessage=text=>setPartial(previous=>previous+text)
      let result:string
      try{
        result=await invoke<string>('assistant_ask',{provider,history,question:prompt,context,events,effort:provider==='lmstudio'&&levels.includes(effort)?effort:null,model:provider==='lmstudio'?model.trim():'',port:provider==='lmstudio'?number:1234})
      }finally{
        events.onmessage=()=>{}
        setPartial('')
      }
      const blocks=crash?result.split(/^```(?:python|py)?[^\S\n]*\r?\n([\s\S]*?)^```[^\S\n]*$/gmi):[]
      const correction=blocks.length===3 && blocks[1].trim()?blocks[1]:undefined
      setThreads(prev=>({...prev,[provider]:[...(prev[provider]??[]),{question:prompt,context,answer:result,target,correction,consoleText}]}))
      if(!crash&&attachment)removeAttachment(attachment)
    }catch(e){
      if(!crash)setQuestion(question)
      setError(String(e))
    }finally{inFlight.current=false;reportBusy(false);setWaiting(false);setSent('')}
  }
  function insert(code:string,at:Target,wholeScript=false){
    const ed=editorRef.current,doc=ed?.getModel()
    if(!ed||!doc)return
    const range=wholeScript?doc.getFullModelRange():at.range
    if(!wholeScript&&range.isEmpty())return
    if(doc.getVersionId()!==at.version){
      if(wholeScript){setError('Le script a changé depuis l’aperçu. Cliquez sur « Comparer » pour actualiser la comparaison.');return}
      setError('La sélection d’origine a changé. Copiez le bloc ou comparez-le au script actuel.')
      return
    }
    beforeEdit()
    ed.pushUndoStop()
    ed.executeEdits('assistant',[{range,text:code}])
    ed.pushUndoStop();ed.focus()
    setError('')
  }
  function userMessage(message:string,consoleText?:string){
    const count=consoleText?.trimEnd().split(/\r?\n/).length
    return <div className="user-bubble" aria-label="Votre message"><p>{message}</p>{consoleText&&
      <details><summary>Console jointe · {count} ligne{count===1?'':'s'}</summary><pre>{consoleText}</pre></details>}</div>
  }
  return <aside hidden={!visible} className="assistant-pane" aria-label="Assistant Python">
    <div className="strip assistant-heading"><div><strong>Assistant</strong>{provider==='lmstudio'?
      <select className="chat-model" aria-label="Modèle de la discussion" title={model||'Modèle automatique de LM Studio'} value={model} disabled={waiting} onChange={e=>chooseModel(e.target.value)}>
        <option value="">LM Studio · auto</option>
        {model&&!models.some(m=>m.id===model)&&<option value={model}>{model}</option>}
        {models.map(m=><option key={m.id} value={m.id}>{m.id}</option>)}
      </select>:<span className="provider-name">Codex</span>}
        <div role="group" aria-label="Position du chat" className="dock-options">
          {dockOptions.map(([position,label])=><button key={position} type="button" aria-label={label} title={label} aria-pressed={dock===position} onClick={()=>setDock(position)}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20">
              <rect x="1.5" y="3" width="17" height="14" rx="2" fill="none" stroke="currentColor"/>
              <rect x={position==='right'?12:3} y={position==='bottom'?11:4.5} width={position==='bottom'?14:5} height={position==='bottom'?4.5:11} rx="0.7" fill="currentColor"/>
            </svg>
          </button>)}
        </div>{provider==='lmstudio'&&connection&&<small className={'connection '+(connection==='connecté'?'online':'')}>● {connection}</small>}</div>{turns.length>0 && <button disabled={waiting} onClick={()=>{setThreads(prev=>({...prev,[provider]:[]}));setError('');setQuestion('')}} title="Nouvelle discussion">+ Nouvelle discussion</button>}<button onClick={close} aria-label="Fermer l’assistant">×</button></div>
    <div className="assistant-body">
      {(turns.length>0||sent)&&<div ref={log} className="chat-log" role="log" aria-label="Discussion">
        {turns.map((turn,index)=><article key={index}>{userMessage(turn.question,turn.consoleText)}<strong className="reply-label">Assistant</strong>
          <ChatReply text={turn.answer} compare={code=>review(turn,code)} disabled={runDisabled} insert={turn.target.range.isEmpty()?undefined:code=>insert(code,turn.target)}/>
          {turn.correction&&<button disabled={runDisabled} onClick={()=>review(turn)}>Appliquer la correction</button>}</article>)}
        {sent&&<article>{userMessage(sent,pendingConsole)}{partial?<><strong className="reply-label">Assistant</strong><ChatReply text={partial}/></>:<span role="status">Réponse en cours…</span>}</article>}
      </div>}
      <div className="message-box composer">
        {!waiting&&<div className="console-chip">{joined.code?<details><summary>{joined.label}</summary><pre>{joined.code}</pre></details>:<span>{joined.label}</span>}</div>}
        {attachment&&!waiting&&<div className="console-chip"><details><summary>Sortie console jointe</summary><pre>{attachment.text}</pre></details><button aria-label="Retirer la sortie" title="Retirer la sortie" onClick={()=>removeAttachment(attachment)}>×</button></div>}
        <div className="message-row"><textarea aria-label="Question à l’assistant" disabled={waiting} rows={2} placeholder={turns.length?'Continuer la discussion…':'Poser une question sur le code…'} value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.altKey&&!e.nativeEvent.isComposing&&e.nativeEvent.keyCode!==229){e.preventDefault();void ask()}}}/>
        {provider==='lmstudio'&&(levels.length>1?<select aria-label="Effort pour la discussion" disabled={waiting||!levels.length} className="chat-effort" value={levels.includes(effort)?effort:''} onChange={e=>setEffort(e.target.value)}><option value="">Effort · par défaut</option>{levels.map(v=><option key={v} value={v}>{effortLabels[v]}</option>)}</select>:<small className="effort-note">{!connection?'Vérification du modèle…':connection!=='connecté'?'Capacités indisponibles':levels.length?'Raisonnement fixe · '+effortLabels[levels[0]]:'Effort non réglable pour ce modèle'}</small>)}<button className="send-message" aria-label="Envoyer la question" title="Entrée pour envoyer · Maj+Entrée pour aller à la ligne" disabled={waiting||!question.trim()} onClick={()=>void ask()}>↑</button></div>
      </div>
      {error&&<p role="alert">{error}</p>}
    </div>
    </aside>
}
