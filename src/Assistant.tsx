import {useEffect,useRef,useState} from 'react'
import type {RefObject} from 'react'
import type {editor,Selection} from 'monaco-editor'
import {invoke} from '@tauri-apps/api/core'
import {diffLines} from 'diff'
import './assistant.css'

import type {LlmConfig} from './Preferences'
type Props = {config:LlmConfig,visible:boolean, editorRef:RefObject<editor.IStandaloneCodeEditor|null>, close:()=>void, beforeEdit:()=>void, runDisabled:boolean, runNew:(code:string)=>void}
type Target = {version:number, range:Selection}
type Turn = {question:string,context:string,answer:string,target:Target,correction?:string}
type Attachment={text:string}
export type Crash={source:string,diagnostic:string,version:number}
export default function Assistant({runCurrent,explain,consume,reportBusy,attachment,removeAttachment,config,visible,editorRef,close,beforeEdit,runDisabled,runNew}:Props & {runCurrent:()=>void,explain:Crash|null,consume:()=>void,reportBusy:(busy:boolean)=>void,attachment:Attachment|null,removeAttachment:(item:Attachment)=>void}){
  const {provider,scope,model,port}=config
  const [question,setQuestion]=useState(''),[error,setError]=useState('')
  const [threads,setThreads]=useState<Record<string,Turn[]>>({})
  const turns=threads[provider]??[]
  const [sent,setSent]=useState('')
  const dialog=useRef<HTMLDialogElement>(null)
  const [preview,setPreview]=useState<{turn:Turn,changes:ReturnType<typeof diffLines>}|null>(null)
  function review(turn:Turn){
    const doc=editorRef.current?.getModel()
    if(!doc||doc.getVersionId()!==turn.target.version){setError('Le document a changé. Relancez la demande pour appliquer cette réponse.');return}
    if(!turn.correction)return
    const changes=diffLines(doc.getValue().replace(/\r\n/g,'\n'),turn.correction.replace(/\r\n/g,'\n'),{timeout:350})
    if(!changes){setError('Comparaison trop volumineuse pour afficher un aperçu.');return}
    setError('')
    setPreview({turn,changes})
    dialog.current?.showModal()
  }
  const log=useRef<HTMLDivElement>(null)
  useEffect(()=>{
    if(visible && log.current)log.current.scrollTop=log.current.scrollHeight
  },[visible,threads,sent,provider])
  const [waiting,setWaiting]=useState(false)
  const inFlight=useRef(false)
  useEffect(()=>{
    if(explain&&!inFlight.current){consume();void ask(explain)}
  },[explain,waiting])
  async function ask(crash?:Crash){
    const ed=editorRef.current,doc=ed?.getModel(),range=ed?.getSelection()
    if(!doc||!range||inFlight.current||(!crash&&!question.trim()))return
    const code=scope==='file'?doc.getValue():scope==='selection'||scope==='auto'?doc.getValueInRange(range):''
    if(!crash&&scope==='selection'&&!code){setError('Sélectionnez du code dans l’éditeur.');return}
    const context=crash?crash.source+'\n\nErreur de cette exécution :\n'+crash.diagnostic:[code,attachment&&'Sortie console :\n'+attachment.text].filter(Boolean).join('\n\n')
    const number=Number(port)
    if(provider==='lmstudio'&&(!Number.isInteger(number)||number<1||number>65535)){setError('Port invalide.');return}
    const target={version:crash?.version??doc.getVersionId(),range}, prompt=crash?'Explique la cause de cette erreur et indique la ligne concernée. Fournis ensuite le script Python complet corrigé dans un seul bloc Markdown python. Conserve toutes les autres fonctionnalités.':question.trim()
    reportBusy(true)
    inFlight.current=true;setWaiting(true);setError('');setSent(prompt)
    try{
      const history=turns.slice(-12).map(({question,context,answer})=>({question,context,answer}))
      const result=await invoke<string>('assistant_ask',{provider,history,question:prompt,context,model:provider==='lmstudio'?model.trim():'',port:provider==='lmstudio'?number:1234})
      const blocks=crash?result.split(/^```(?:python|py)?[^\S\n]*\r?\n([\s\S]*?)^```[^\S\n]*$/gmi):[]
      const correction=blocks.length===3 && blocks[1].trim()?blocks[1]:undefined
      setThreads(prev=>({...prev,[provider]:[...(prev[provider]??[]),{question:prompt,context,answer:result,target,correction}]}))
      if(!crash){setQuestion('');if(attachment)removeAttachment(attachment)}
    }catch(e){setError(String(e))}finally{inFlight.current=false;reportBusy(false);setWaiting(false);setSent('')}
  }
  function insert(code:string,at:Target,wholeScript=false){
    const ed=editorRef.current,doc=ed?.getModel()
    if(!ed||!at||doc?.getVersionId()!==at.version){setError('Le document a changé. Relancez la demande pour appliquer cette réponse.');return}
    beforeEdit()
    ed.pushUndoStop()
    const applied=ed.executeEdits('assistant',[{range:wholeScript?doc.getFullModelRange():at.range,text:code}])
    ed.pushUndoStop();ed.focus()
    setError('')
    if(applied&&wholeScript)runCurrent()
  }
  return <aside hidden={!visible} className="assistant-pane" aria-label="Assistant Python">
    <div className="strip assistant-heading"><div><strong>Assistant</strong><span className="provider-name">{provider==='lmstudio'?'LM Studio':'Codex'}</span></div><button onClick={close} aria-label="Fermer l’assistant">×</button></div>
    <div className="assistant-body">
      {(turns.length>0||sent)&&<div ref={log} className="chat-log" role="log" aria-label="Discussion">
        {turns.map((turn,index)=><article key={index}><strong>Vous</strong><p>{turn.question}</p><strong>{provider==='lmstudio'?'LM Studio':'Codex'}</strong>
          {turn.answer.split(/^```(?:python|py)?[^\S\n]*\r?\n([\s\S]*?)^```[^\S\n]*$/gmi).map((part,i)=>i%2?<div key={i}><pre>{part}</pre>
            <button className="execute" disabled={runDisabled||!part.trim()} onClick={()=>runNew(part)}>▶ Ouvrir dans Nouveau et exécuter</button>{' '}
            <button onClick={()=>insert(part,turn.target)}>{turn.target.range.isEmpty()?'Insérer le code':'Remplacer la sélection'}</button></div>:<p key={i}>{part.trim()}</p>)}{turn.correction&&<button className="execute" disabled={runDisabled} onClick={()=>review(turn)}>Appliquer la correction</button>}</article>)}
        {sent&&<article><strong>Vous</strong><p>{sent}</p></article>}
      </div>}
      <div className="message-box">
        {attachment&&<div className="console-chip"><details><summary>Sortie console jointe</summary><pre>{attachment.text}</pre></details><button aria-label="Retirer la sortie" title="Retirer la sortie" onClick={()=>removeAttachment(attachment)}>×</button></div>}
        <div className="message-row"><textarea aria-label="Question à l’assistant" disabled={waiting} rows={2} placeholder={turns.length?'Continuer la discussion…':'Poser une question sur le code…'} value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.ctrlKey&&e.key==='Enter'){e.preventDefault();void ask()}}}/>
        <button className="send-message" aria-label="Envoyer la question" title="Envoyer (Ctrl+Entrée)" disabled={waiting||!question.trim()} onClick={()=>void ask()}>↑</button></div>
      </div>
      {waiting&&<span role="status">Réponse en cours…</span>}
      {error&&<p role="alert">{error}</p>}
      {turns.length>0 && <button disabled={waiting} onClick={()=>{setThreads(prev=>({...prev,[provider]:[]}));setError('');setQuestion('')}}>Nouvelle discussion</button>}
    </div>
    <dialog className="correction-preview" ref={dialog} aria-labelledby="diff-title" onClose={()=>setPreview(null)}>
      <h2 id="diff-title">Aperçu des changements</h2>
      <div className="diff-code" tabIndex={0}>{preview?.changes?.map((chunk,i)=>
        <pre key={i} className={chunk.added?'added':chunk.removed?'removed':''}>{chunk.value.replace(/\n$/,'').split('\n').map(line=>(chunk.added?'+ ':chunk.removed?'− ':'  ')+line).join('\n')}</pre>)}</div>
      <div className="diff-actions"><button autoFocus onClick={()=>dialog.current?.close()}>Annuler</button>
      <button className="execute" disabled={runDisabled||!preview?.changes?.some(c=>c.added||c.removed)} onClick={()=>{
        dialog.current?.close()
        if(preview?.turn.correction)insert(preview.turn.correction,preview.turn.target,true)
      }}>Appliquer et relancer</button></div>
    </dialog></aside>
}
