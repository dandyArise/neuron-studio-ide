import {parse, type ParseError} from 'jsonc-parser'
import type {editor} from 'monaco-editor'

export type ImportedTheme = {name:string, light:boolean, colors:Record<string,string>, rules:editor.ITokenThemeRule[]}
function object(v:unknown):v is Record<string,unknown>{
  return !!v && typeof v==='object' && !Array.isArray(v)
}
function color(v:unknown){
  if(typeof v!=='string'||!/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(v))return undefined
  return v.length<=5?'#'+Array.from(v.slice(1),c=>c+c).join(''):v
}
const scopes:Record<string,string>={comment:'comment',string:'string',keyword:'keyword',storage:'keyword',
  'constant.numeric':'number','constant.language':'keyword','entity.name.type':'type.identifier',
  'support.type':'type.identifier',variable:'identifier'}
export function importTheme(source:string,filename:string):ImportedTheme{
  const errors:ParseError[]=[]
  const doc:unknown=parse(source.replace(/^\uFEFF/,''),errors,{allowTrailingComma:true})
  if(errors.length||!object(doc))throw Error('Le fichier contient du JSON invalide.')
  if(doc.include||typeof doc.tokenColors==='string')throw Error('Ce thème dépend d’un autre fichier. Importez un thème JSON autonome.')
  const colors:Record<string,string>=Object.create(null)
  if(object(doc.colors))for(const [key,value] of Object.entries(doc.colors)){
    const hex=color(value)
    if(hex && /^[a-z][\w-]*(?:\.[\w-]+)+$/i.test(key))colors[key]=hex
  }
  const rules:editor.ITokenThemeRule[]=[]
  if(Array.isArray(doc.tokenColors))for(const entry of doc.tokenColors){
    if(!object(entry)||!object(entry.settings))continue
    const fg=color(entry.settings.foreground)
    const style=entry.settings.fontStyle
    const fontStyle=typeof style==='string' && style.split(/\s+/).every(s=>['','italic','bold','underline','strikethrough'].includes(s))?style:undefined
    if(!fg && fontStyle===undefined)continue
    const parts=Array.isArray(entry.scope)?entry.scope:[entry.scope]
    const tokens=new Set<string>()
    if(!entry.scope)tokens.add('')
    for(const part of parts)if(typeof part==='string')for(const selector of part.split(',')){
      const leaf=selector.trim().split(/\s+/).pop()??''
      const match=Object.keys(scopes).find(s=>leaf===s||leaf.startsWith(s+'.'))
      if(match)tokens.add(scopes[match])
    }
    for(const token of tokens)rules.push({token,foreground:fg?.slice(1,7),fontStyle})
  }
  if(!Object.keys(colors).length && !rules.length)throw Error('Aucune couleur de thème VS Code compatible dans ce fichier.')
  const bg=colors['editor.background']??'#000000'
  const rgb=[1,3,5].map(i=>parseInt(bg.slice(i,i+2),16))
  const light=doc.type==='light'||(doc.type!=='dark' && rgb[0]*0.299+rgb[1]*0.587+rgb[2]*0.114>145)
  return {name:(typeof doc.name==='string' && doc.name.trim()||filename.replace(/\.json$/i,'')).slice(0,100),light,colors,rules}
}
