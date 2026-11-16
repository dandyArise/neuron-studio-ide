import {useEffect,useRef} from 'react'
import {editor} from 'monaco-editor/esm/vs/editor/editor.api'
import {applyHunk} from './applyHunk'

export default function CodeDiff({before,after,onApply}:{before:string,after:string,onApply?:(value:string)=>void}){
  const host=useRef<HTMLDivElement>(null)
  const apply=useRef(onApply)
  apply.current=onApply
  const gutter=useRef<HTMLDivElement>(null)
  const enabled=!!onApply
  const scroll=useRef(0)
  useEffect(()=>{
    if(!host.current)return
    const original=editor.createModel(before,'python')
    const modified=editor.createModel(after,'python')
    const view=editor.createDiffEditor(host.current,{automaticLayout:true,readOnly:true,
      renderSideBySide:true,useInlineViewWhenSpaceIsLimited:false,minimap:{enabled:false},
      scrollBeyondLastLine:false,originalAriaLabel:'Avant',modifiedAriaLabel:'Après'})
    view.setModel({original,modified})
    const right=view.getModifiedEditor()
    const restore=view.onDidUpdateDiff(()=>{restore.dispose();right.setScrollTop(scroll.current)})
    function draw(){
      const rail=gutter.current
      if(!rail||!enabled)return
      rail.replaceChildren()
      const left=right.getDomNode()?.getBoundingClientRect().left
      if(left===undefined)return
      rail.style.left=(left-rail.parentElement!.getBoundingClientRect().left)+'px'
      for(const hunk of view.getLineChanges()??[]){
        const line=Math.max(1,hunk.modifiedStartLineNumber+(hunk.modifiedEndLineNumber?0:1))
        const y=right.getTopForLineNumber(Math.min(line,modified.getLineCount()))-right.getScrollTop()
        if(y<0||y>=rail.clientHeight)continue
        const button=document.createElement('button')
        button.type='button'
        button.textContent='←'
        button.title=button.ariaLabel='Appliquer ce bloc au script · ligne '+line
        button.style.top=y+'px'
        button.onclick=()=>apply.current?.(applyHunk(before,after,hunk))
        rail.append(button)
      }
    }
    const listeners=[view.onDidUpdateDiff(draw),right.onDidScrollChange(draw),right.onDidLayoutChange(draw)]
    return ()=>{scroll.current=right.getScrollTop();restore.dispose();listeners.forEach(l=>l.dispose());gutter.current?.replaceChildren();view.dispose();original.dispose();modified.dispose()}
  },[before,after,enabled])
  return <><div className="diff-columns"><span>Avant</span><span>Après</span></div><div className="side-diff" style={{position:'relative',isolation:'isolate'}}><div ref={host} style={{position:'absolute',inset:0,zIndex:0}}/><div ref={gutter} className="hunk-gutter"/></div></>
}
