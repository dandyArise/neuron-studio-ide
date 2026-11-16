import type {editor} from 'monaco-editor/esm/vs/editor/editor.api'

export function applyHunk(before:string,after:string,hunk:editor.ILineChange){
  const lines=before.split(/\r\n|\r|\n/)
  const proposed=after.split(/\r\n|\r|\n/)
  // For an empty side Monaco reports the preceding line and an end of zero.
  const start=hunk.originalEndLineNumber?hunk.originalStartLineNumber-1:hunk.originalStartLineNumber
  const end=hunk.originalEndLineNumber||start
  const added=hunk.modifiedEndLineNumber?proposed.slice(hunk.modifiedStartLineNumber-1,hunk.modifiedEndLineNumber):[]
  return [...lines.slice(0,start),...added,...lines.slice(end)].join(before.match(/\r\n|\r|\n/)?.[0]??'\n')
}
