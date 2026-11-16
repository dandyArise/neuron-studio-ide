import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import type {Terminal} from '@xterm/xterm'
import './appearance.css'

import type {ImportedTheme} from './importTheme'
export type Appearance = {theme:keyof typeof palettes|'imported', library:ImportedTheme[], selected:number, font:string, size:number}
export const fontChoices = ['Cascadia Code', 'Consolas', 'Courier New', 'Lucida Console']
const defaults: Appearance = {theme:'neuron',library:[],selected:0,font:'Cascadia Code',size:14}
const key = 'neuron.appearance.v1'

const palettes = {
  atelier: {
    surface:'#14130f',panel:'#1b1a15',raised:'#2a2822',edge:'#3a372e',text:'#ede6d8',
    muted:'#aaa291',accent:'#e8a66a',success:'#9bc48a',selection:'#514133',
    keyword:'#e8a66a',string:'#9bc48a',number:'#e8c98a',comment:'#a29a87',red:'#e5786d',blue:'#a6c6d1',
  },
  neuron: {
    surface:'#121311',panel:'#1a1c18',raised:'#262923',edge:'#43473c',text:'#e7e4da',
    muted:'#b6b8ac',accent:'#e2ad77',success:'#b6d49a',selection:'#45523e',
    keyword:'#e0a675',string:'#b5d1a2',number:'#a8cbbd',comment:'#9ba18e',red:'#f29b94',blue:'#a2c4de',
  },
  original: {
    surface:'#121311',panel:'#1a1b18',raised:'#20221e',edge:'#373931',text:'#e7e4da',
    muted:'#b1b2a8',accent:'#e2ad77',success:'#b6d49a',selection:'#264f78',
    keyword:'#d69f6f',string:'#aec49a',number:'#a8cbbd',comment:'#84887c',red:'#f29b94',blue:'#a2c4de',
  },
  light: {
    surface:'#ffffff',panel:'#f3f3f3',raised:'#ffffff',edge:'#c8c8c8',text:'#000000',
    muted:'#616161',accent:'#007acc',success:'#17683a',selection:'#add6ff',
    keyword:'#0000ff',string:'#a31515',number:'#098658',comment:'#008000',red:'#a1260d',blue:'#267f99',
  },
  modern: {
    surface:'#ffffff',panel:'#f8f8f8',raised:'#f2f2f2',edge:'#cecece',text:'#3b3b3b',
    muted:'#616161',accent:'#005fb8',success:'#17683a',selection:'#add6ff',
    keyword:'#0000ff',string:'#a31515',number:'#098658',comment:'#008000',red:'#a1260d',blue:'#267f99',
  },
  dracula: {
    surface:'#282a36',panel:'#21222c',raised:'#343746',edge:'#50546a',text:'#f8f8f2',
    muted:'#c2c5d8',accent:'#bd93f9',success:'#50fa7b',selection:'#44475a',
    keyword:'#ff79c6',string:'#f1fa8c',number:'#bd93f9',comment:'#a0accf',red:'#ff5555',blue:'#8be9fd',
  },
  monokai: {
    surface:'#272822',panel:'#20211c',raised:'#32332b',edge:'#59594c',text:'#f8f8f2',
    muted:'#c4c2b3',accent:'#e6db74',success:'#a6e22e',selection:'#49483e',
    keyword:'#f92672',string:'#e6db74',number:'#ae81ff',comment:'#aaa899',red:'#ff6787',blue:'#66d9ef',
  },
}

function normalize(value:(Partial<Appearance>&{custom?:ImportedTheme})|null):Appearance {
  const library=Array.isArray(value?.library)?value.library:value?.custom?[value.custom]:[]
  const selected=value?.selected??0
  return {
    library,selected:Number.isInteger(selected)&&library[selected]?selected:0,
    theme:value?.theme==='imported' && library.length ? 'imported' : value?.theme && Object.hasOwn(palettes,value.theme) ? value.theme : defaults.theme,
    font:value?.font && fontChoices.includes(value.font) ? value.font : defaults.font,
    size:typeof value?.size==='number' && Number.isFinite(value.size)
      ? Math.max(11,Math.min(28,Math.round(value.size))) : defaults.size,
  }
}
export function loadAppearance():Appearance {
  try { return normalize(JSON.parse(localStorage.getItem(key) ?? 'null')) }
  catch { return {...defaults} }
}

export function addImportedTheme(current:Appearance,theme:ImportedTheme):Appearance{
  const content=JSON.stringify(theme)
  const index=current.library.findIndex(entry=>JSON.stringify(entry)===content)
  const next:Appearance={...current,theme:'imported',
    library:index<0?[...current.library,theme]:current.library,
    selected:index<0?current.library.length:index}
  try{localStorage.setItem(key,JSON.stringify(next))}
  catch{throw Error('Impossible d’enregistrer ce thème dans le stockage local.')}
  return next
}

const registered=new Set<Appearance['theme']>()
export function applyAppearance(input:Appearance, ed:monaco.editor.IStandaloneCodeEditor|null, term:Terminal|null) {
  const value=normalize(input), custom=value.theme==='imported'?value.library[value.selected]:undefined
  const base=palettes[value.theme==='imported'?(custom?.light?'light':'neuron'):value.theme]
  const c=custom?.colors??{}
  const p=custom?{...base,surface:c['editor.background']??base.surface,text:c['editor.foreground']??base.text,
    panel:c['sideBar.background']??base.panel,selection:c['editor.selectionBackground']??base.selection,
    accent:c['focusBorder']??base.accent}:base
  const name=value.theme==='original'?'neuron':'studio-'+value.theme
  const light=custom?.light??(value.theme==='light'||value.theme==='modern')
  const fontFamily='"'+value.font+'", Consolas, monospace'
  const root=document.documentElement
  root.dataset.appearance=value.theme
  root.style.colorScheme=light?'light':'dark'
  for(const [token,color] of Object.entries(p))root.style.setProperty('--'+token,color)
  root.style.setProperty('--code-font',fontFamily)
  root.style.setProperty('--code-size',value.size+'px')
  if (value.theme!=='original' && (custom || !registered.has(value.theme))){
    monaco.editor.defineTheme(name,{base:light?'vs':'vs-dark',inherit:true,rules:[
      {token:'keyword',foreground:p.keyword.slice(1)},
      {token:'comment',foreground:p.comment.slice(1),fontStyle:light?'':'italic'},
      {token:'string',foreground:p.string.slice(1)},
      {token:'number',foreground:p.number.slice(1)},
      {token:'type.identifier',foreground:p.blue.slice(1)},
      ...(custom?.rules??[]),
    ],colors:{
      'editor.background':p.surface,'editor.foreground':p.text,'editorCursor.foreground':p.accent,
      'editor.lineHighlightBackground':p.raised,'editor.selectionBackground':p.selection,
      'editorLineNumber.foreground':p.comment,'editorLineNumber.activeForeground':p.text,
      'editorHoverWidget.background':p.panel,'editorHoverWidget.foreground':p.text,
      'editorHoverWidget.border':p.edge,'editorHoverWidget.highlightForeground':p.accent,
      'editorSuggestWidget.background':p.panel,'editorSuggestWidget.foreground':p.text,
      'editorSuggestWidget.border':p.edge,'editorSuggestWidget.selectedBackground':p.selection,
      'textCodeBlock.background':p.surface,'focusBorder':p.accent,
      ...c,
    }})
    registered.add(value.theme)
  }
  monaco.editor.setTheme(name)
  ed?.updateOptions({fontFamily,fontSize:value.size,lineHeight:Math.round(value.size*1.6)})
  if(term){
    term.options={fontFamily,fontSize:value.size,theme:{
      background:p.surface,foreground:p.text,cursor:p.accent,selectionBackground:p.selection,
      red:p.red,brightRed:p.red,green:p.success,brightGreen:p.success,blue:p.blue,
      cyan:p.blue,yellow:p.accent,magenta:p.keyword,brightBlack:p.comment,
    }}
  }
  try {localStorage.setItem(key,JSON.stringify(value))} catch { /* Settings still apply to this session. */ }
}
