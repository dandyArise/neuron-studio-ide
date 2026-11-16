import {invoke} from '@tauri-apps/api/core'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import 'monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController'
import 'monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution'
import 'monaco-editor/esm/vs/editor/contrib/parameterHints/browser/parameterHints'
import {documentation} from './docTooltip'
import './docTooltip.css'

const kinds = monaco.languages.CompletionItemKind
const kindMap: Record<string, monaco.languages.CompletionItemKind> = {
  class:kinds.Class, function:kinds.Function, module:kinds.Module, keyword:kinds.Keyword,
  param:kinds.Variable, statement:kinds.Variable, property:kinds.Property, instance:kinds.Variable,
}
type Matches = {generation:number, items:{label:string, kind:string}[]}
type Signature = {label:string, params:string[], index:number}

function ask<T>(query: Record<string,unknown>) {
  return invoke<T>('analyze',{query})
}

export function installCompletion(ed:monaco.editor.IStandaloneCodeEditor) {
  let alive = true
  let lastAnalysis: Promise<unknown> = Promise.resolve()
  // Skip canceled edits before sending them to the single Python analysis worker.
  function request<T>(model:monaco.editor.ITextModel, pos:monaco.Position,
                      token:monaco.CancellationToken, mode:string): Promise<T|undefined> {
    const version = model.getVersionId()
    const current = () => alive && !token.isCancellationRequested && !model.isDisposed() && model.getVersionId()===version
    const job = lastAnalysis.then(async () => {
      if (!current()) return
      const prefix = model.getLineContent(pos.lineNumber).slice(0,pos.column-1)
      const result = await ask<T>({mode,source:model.getValue(),line:pos.lineNumber,column:Array.from(prefix).length})
      return current() ? result : undefined
    })
    lastAnalysis = job.catch(()=>{})
    return job
  }
  const refs = new WeakMap<monaco.languages.CompletionItem,{generation:number,index:number}>()
  const completions = monaco.languages.registerCompletionItemProvider('python',{
    triggerCharacters:['.'],
    async provideCompletionItems(model,pos,_context,token){
      const matches = await request<Matches>(model,pos,token,'complete')
      const word = model.getWordUntilPosition(pos)
      const range = new monaco.Range(pos.lineNumber,word.startColumn,pos.lineNumber,pos.column)
      return {suggestions:matches?.items.map(({label,kind},index)=>{
        const item = {label,insertText:label,kind:kindMap[kind]??kinds.Text,detail:kind,range}
        refs.set(item,{generation:matches.generation,index})
        return item
      })??[]}
    },
    async resolveCompletionItem(item,token){
      const ref=refs.get(item)
      if(ref && !token.isCancellationRequested) {
        const doc=await ask<string>({mode:'detail',...ref})
        if(doc && !token.isCancellationRequested)item.documentation=documentation(doc)
      }
      return item
    },
  })
  const hover = monaco.languages.registerHoverProvider('python',{
    async provideHover(model,pos,token){
      if(!model.getWordAtPosition(pos))return
      const doc = await request<string>(model,pos,token,'help')
      if(!doc)return
      return {contents:[documentation(doc)]}
    },
  })
  const signatures=monaco.languages.registerSignatureHelpProvider('python',{
    signatureHelpTriggerCharacters:['(',','],
    async provideSignatureHelp(model,pos,token){
      const items=await request<Signature[]>(model,pos,token,'signature')
      if(!items?.length)return
      return {dispose(){},value:{activeSignature:0,activeParameter:items[0].index,
        signatures:items.map(s=>({label:s.label,parameters:s.params.map(label=>({label})),activeParameter:s.index}))}}
    },
  })
  ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyQ,()=>ed.trigger('keyboard','editor.action.showHover',null),'!suggestWidgetVisible')
  ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyQ,()=>ed.trigger('keyboard','toggleSuggestionDetails',null),'suggestWidgetVisible')
  ed.updateOptions({quickSuggestions:{other:true,comments:false,strings:false},quickSuggestionsDelay:160,
    suggestOnTriggerCharacters:true,wordBasedSuggestions:'off',hover:{enabled:true,delay:330},parameterHints:{enabled:true}})
  return {dispose(){alive=false;completions.dispose();hover.dispose();signatures.dispose()}}
}

