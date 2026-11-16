import {useEffect,useRef,useState} from 'react'
import {invoke} from '@tauri-apps/api/core'
import {addImportedTheme,type Appearance} from './appearance'
import {importTheme} from './importTheme'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import './preferences.css'

export type Section = 'appearance'|'llm'
export type LlmConfig = {provider:'lmstudio'|'codex',scope:'auto'|'none'|'selection'|'file',port:number,model:string,effort?:string}
import {effortLabels,reasoningOptions,type LocalModel} from './reasoning'
const defaults:LlmConfig={provider:'lmstudio',scope:'auto',port:1234,model:''}
export function loadLlm():LlmConfig{
  try{
    const v=JSON.parse(localStorage.getItem('neuron.llm')??'null')
    if(v && ['lmstudio','codex'].includes(v.provider) && ['auto','none','selection','file'].includes(v.scope)
      && Number.isInteger(v.port) && v.port>=1 && v.port<=65535 && typeof v.model==='string')return {provider:v.provider,scope:v.scope,port:v.port,model:v.model,effort:Object.hasOwn(effortLabels,v.effort)?v.effort:''}
  }catch{/* Use defaults if settings cannot be read. */}
  return defaults
}
type Props={initial:Section,appearance:Appearance,change:(v:Appearance)=>void,config:LlmConfig,save:(v:LlmConfig)=>void,close:()=>void}
const palettes=[
  {id:'atelier',name:'Atelier sombre chaud',colors:['#14130f','#e8a66a','#9bc48a']},
  {id:'original',name:'Neuron d’origine',colors:['#121311','#d69f6f','#aec49a']},
  {id:'neuron',name:'Neuron',colors:['#161714','#d69f6f','#aec49a']},
  {id:'dracula',name:'Dracula',colors:['#282a36','#bd93f9','#ff79c6']},
  {id:'monokai',name:'Monokai',colors:['#272822','#a6e22e','#f92672']},
  {id:'light',name:'VS Code · Light',colors:['#ffffff','#0000ff','#a31515']},
  {id:'modern',name:'VS Code · Light Modern',colors:['#f8f8f8','#005fb8','#098658']}
] as const
function PythonPreview({font,size}:Appearance){
  const host=useRef<HTMLDivElement>(null)
  const editor=useRef<monaco.editor.IStandaloneCodeEditor|null>(null)
  useEffect(()=>{
    const model=monaco.editor.createModel('# Liste de salutations\ndef saluer(nom):\n    return "Bonjour " + nom\n\nfor i in range(3):\n    print(saluer(str(i)))','python')
    const instance=monaco.editor.create(host.current!,{model,readOnly:true,domReadOnly:true,
      ariaLabel:'Aperçu Python en lecture seule',automaticLayout:true,minimap:{enabled:false},
      folding:false,glyphMargin:false,lineNumbersMinChars:2,scrollBeyondLastLine:false,
      renderLineHighlight:'none',overviewRulerLanes:0,hover:{enabled:false},padding:{top:8,bottom:8}})
    editor.current=instance
    return ()=>{editor.current=null;instance.dispose();model.dispose()}
  },[])
  useEffect(()=>{editor.current?.updateOptions({fontFamily:'"'+font+'", Consolas, monospace',fontSize:size,lineHeight:Math.round(size*1.6)})},[font,size])
  return <figure className="python-preview"><figcaption>Aperçu Python</figcaption><div ref={host} style={{height:Math.round(size*1.6)*6+26}}/></figure>
}
export default function Preferences({initial,appearance,change,config,save,close}:Props){
  const ref=useRef<HTMLDialogElement>(null),[tab,setTab]=useState(initial)
  const [draft,setDraft]=useState(config),[secret,setSecret]=useState('')
  const [stored,setStored]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const picker=useRef<HTMLInputElement>(null)
  const [importError,setImportError]=useState('')
  const [models,setModels]=useState<LocalModel[]>([]),[refresh,setRefresh]=useState(0)
  const [notice,setNotice]=useState(''),[manual,setManual]=useState(false)
  const levels=reasoningOptions(models,draft.model)
  useEffect(()=>{
    if(tab!=='llm'||draft.provider!=='lmstudio')return
    let active=true
    setModels([]);setNotice('Recherche des modèles…')
    const timer=setTimeout(async()=>{
      try{
        const found=await invoke<LocalModel[]>('assistant_models',{port:draft.port,token:secret||null})
        if(active){
          setModels(found);setNotice(found.length?'':'Aucun modèle de conversation détecté.')
          setDraft(v=>v.effort&&!reasoningOptions(found,v.model).includes(v.effort)?{...v,effort:''}:v)
        }
      }catch(e){if(active)setNotice(String(e))}
    },350)
    return ()=>{active=false;clearTimeout(timer)}
  },[tab,draft.provider,draft.port,refresh,secret])
  async function openTheme(file?:File){
    if(!file)return
    try{
      if(file.size>1024*1024)throw Error('Choisissez un thème de moins de 1 Mo.')
      const custom=importTheme(await file.text(),file.name)
      change(addImportedTheme(appearance,custom))
      setImportError('')
    }catch(e){setImportError(e instanceof Error?e.message:'Lecture du thème impossible.')}
  }
  useEffect(()=>{ref.current?.showModal();void invoke<boolean>('assistant_token_status').then(setStored).catch(e=>setError(String(e)))},[])
  const [update,setUpdate]=useState(''),[available,setAvailable]=useState('')
  async function checkUpdate(){
    setAvailable('');setUpdate('Recherche en cours…')
    try{
      const response=await fetch('https://api.github.com/repos/dandyArise/neuron-studio-ide/releases/latest',{signal:AbortSignal.timeout(15000)})
      if(!response.ok)throw Error('GitHub HTTP '+response.status)
      const release=await response.json()
      const current=(await import('../package.json')).version
      const match=/^v(\d+\.\d+\.\d+)$/.exec(release.tag_name)
      if(!match)throw Error('Version publiée non reconnue.')
      const parts=current.split('.').map(Number)
      const difference=match[1].split('.').map((v,i)=>Number(v)-parts[i]).find(v=>v!==0)??0
      if(difference>0){
        if(!release.assets?.some((a:{name:string})=>a.name==='Neuron-Studio-Windows-x64.exe'))throw Error('Exécutable Windows indisponible.')
        setAvailable(match[1]);setUpdate('Version '+match[1]+' disponible.')
      }else setUpdate('Version '+current+' à jour.')
    }catch(e){setUpdate('Vérification impossible. '+String(e))}
  }
  async function finish(){
    if(draft.provider==='lmstudio' && (!Number.isInteger(draft.port)||draft.port<1||draft.port>65535)){setTab('llm');setError('Choisissez un port entre 1 et 65535.');return}
    setBusy(true)
    try{
      if(secret && draft.provider==='lmstudio')await invoke('assistant_save_token',{token:secret})
      localStorage.setItem('neuron.llm',JSON.stringify(draft));save(draft);close()
    }catch(e){setError(String(e));setBusy(false)}
  }
  return <dialog ref={ref} className="preferences" aria-labelledby="prefs-title" onCancel={e=>{if(busy)e.preventDefault();else close()}}>
    <div className="prefs-title"><h2 id="prefs-title">Préférences</h2><button aria-label="Fermer les préférences" disabled={busy} onClick={close}>×</button></div>
    <div className="prefs-layout"><div className="prefs-nav" aria-label="Sections">
      <button aria-pressed={tab==='appearance'} onClick={()=>setTab('appearance')}>Apparence</button>
      <button aria-pressed={tab==='llm'} onClick={()=>setTab('llm')}>Assistant LLM</button>
      <button disabled={update==='Recherche en cours…'} onClick={checkUpdate}>Vérifier les mises à jour</button>
      <small role="status">{update}</small>
      {available&&<button onClick={()=>invoke('download_update').catch(e=>setUpdate(String(e)))}>Télécharger la version {available}</button>}
    </div><section className="prefs-content">
    {tab==='appearance'?<>
      <h3>Apparence</h3>
      <fieldset><legend>Thème de couleurs</legend><div className="theme-choices">{palettes.map(t=><button key={t.id} aria-pressed={appearance.theme===t.id} onClick={()=>change({...appearance,theme:t.id})}><span className="theme-preview" style={{background:t.colors[0]}}>{t.colors.slice(1).map(c=><i key={c} style={{background:c}}/>)}</span>{t.name}</button>)}</div></fieldset>
      <div className="prefs-row">
        <input hidden type="file" accept=".json,.jsonc" ref={picker} onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';void openTheme(file)}}/>
        <button onClick={()=>picker.current?.click()}>Importer un thème VS Code…</button>
        {appearance.library.length>0&&<label>Thèmes importés<select value={appearance.theme==='imported'?appearance.selected:''} onChange={e=>change({...appearance,theme:'imported',selected:Number(e.target.value)})}>
          <option disabled value="">Choisir un thème</option>
          {appearance.library.map((entry,i)=><option key={i} value={i}>{entry.name}{appearance.library.some((other,j)=>j!==i&&other.name===entry.name)?' · '+(i+1):''}</option>)}
        </select></label>}
      </div>
      {importError&&<p role="alert">{importError}</p>}
      <div className="prefs-row"><label>Police du code<select value={appearance.font} onChange={e=>change({...appearance,font:e.target.value})}>
        {Array.from(new Set([appearance.font,'Cascadia Code','Consolas','Courier New','Lucida Console'])).map(f=><option key={f}>{f}</option>)}</select></label>
      <label>Taille<select value={appearance.size} onChange={e=>change({...appearance,size:Number(e.target.value)})}>{Array.from({length:18},(_,i)=>i+11).map(s=><option value={s} key={s}>{s} px</option>)}</select></label></div>
      <PythonPreview {...appearance}/>
    </>:<>
      <h3>Assistant LLM</h3>
      <div className="prefs-row"><label>Service<select value={draft.provider} onChange={e=>setDraft({...draft,provider:e.target.value as LlmConfig['provider']})}><option value="lmstudio">LM Studio · local</option><option value="codex">Codex CLI</option></select></label>
      <label>Code à joindre<select value={draft.scope} onChange={e=>setDraft({...draft,scope:e.target.value as LlmConfig['scope']})}><option value="auto">Sélection ou script ouvert</option><option value="none">Question seule</option><option value="selection">Sélection uniquement</option><option value="file">Fichier entier</option></select></label></div>
      {draft.provider==='lmstudio'?<>
        <div className="prefs-row model-controls"><label>Modèle<select className="model-list" value={manual?'@manual':draft.model} onChange={e=>{
          if(e.target.value==='@manual'){setManual(true);return}
          setManual(false);setDraft({...draft,model:e.target.value,effort:''})
        }}><option value="">Automatique · premier modèle chargé</option>
        {draft.model&&!models.some(m=>m.id===draft.model)&&<option>{draft.model}</option>}
        {models.map(m=><option key={m.id} value={m.id}>{m.id}{m.loaded?' · chargé':''}</option>)}
        <option value="@manual">Saisir un identifiant…</option></select></label>
        <button onClick={()=>setRefresh(n=>n+1)}>Actualiser les modèles</button></div>
        <label>Serveur local<div className="local-address"><span>http://localhost:</span><input aria-label="Port local" type="number" value={draft.port||''} onChange={e=>setDraft({...draft,port:Number(e.target.value),effort:''})}/></div></label>
        {manual&&<label>Identifiant du modèle<input value={draft.model} onChange={e=>setDraft({...draft,model:e.target.value,effort:''})}/></label>}
        {notice&&<p role="status">{notice}</p>}
        {levels.length>0&&<label>Effort de raisonnement<select value={draft.effort||''} onChange={e=>setDraft({...draft,effort:e.target.value})}>
          <option value="">Par défaut du modèle</option>
          {levels.map(v=><option key={v} value={v}>{effortLabels[v]}</option>)}
        </select></label>}
        <label>{stored?'Jeton enregistré dans Windows':'Jeton LM Studio'}<input type="password" autoComplete="new-password" value={secret} placeholder={stored?'Remplacer le jeton':'Si requis'} onChange={e=>setSecret(e.target.value)}/></label>
      </>:<p>La question et le code choisi seront transmis au service configuré dans Codex CLI.</p>}
    </>}
    {error&&<p role="alert">{error}</p>}
    </section></div>
    <div className="prefs-actions"><button className="execute" onClick={finish} disabled={busy}>{busy?'Enregistrement…':'Terminé'}</button></div>
  </dialog>
}

