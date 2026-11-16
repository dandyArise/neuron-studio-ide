import {createContext,useContext,useEffect,useState} from 'react'
import Markdown,{type Components} from 'react-markdown'
import {editor} from 'monaco-editor/esm/vs/editor/editor.api'

type Actions={compare?:(code:string)=>void,insert?:(code:string)=>void,disabled?:boolean}
const ActionsContext=createContext<Actions>({})
function Block({code,language}:{code:string,language:string}){
  const actions=useContext(ActionsContext)
  const [expanded,setExpanded]=useState(false)
  const [copyLabel,setCopyLabel]=useState('Copier')
  const [colored,setColored]=useState<{source:string,html:string}>()
  const lines=code.split('\n'),shown=expanded?code:lines.slice(0,12).join('\n')
  const python=['python','py'].includes(language)
  useEffect(()=>{
    let active=true
    if(python)editor.colorize(shown,'python',{}).then(html=>{if(active)setColored({source:shown,html})}).catch(()=>{})
    return ()=>{active=false}
  },[shown,python])
  return <div className="reply-code"><div className="code-actions"><span>{language} · {lines.length} ligne{lines.length>1?'s':''}</span>
    {python&&actions.compare&&<button title="Comparer avec le fichier ouvert" disabled={actions.disabled} onClick={()=>actions.compare?.(code)}>Comparer</button>}
    {actions.insert&&<button onClick={()=>actions.insert?.(code)}>Remplacer la sélection</button>}
    <button onClick={async()=>{try{await navigator.clipboard.writeText(code);setCopyLabel('Copié')}catch{setCopyLabel('Copie impossible')}}}>{copyLabel}</button></div>
    {python&&colored?.source===shown?<pre dangerouslySetInnerHTML={{__html:colored.html}}/>:<pre>{shown}</pre>}
    {lines.length>12&&<button aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'Replier':'Afficher tout'}</button>}</div>
}
const components:Components={
  pre({node}) {
    const child=node?.children[0]
    if(child?.type!=='element')return null
    const code=child.children.map(c=>c.type==='text'?c.value:'').join('').replace(/\n$/,'')
    const language=String(child.properties.className??'').replace(/^language-/,'')||'python'
    return <Block code={code} language={language}/>
  }
}
export default function ChatReply({text,...actions}:Actions&{text:string}){
  return <ActionsContext.Provider value={actions}><div className="chat-markdown"><Markdown skipHtml components={components} disallowedElements={['img']}>{text}</Markdown></div></ActionsContext.Provider>
}
