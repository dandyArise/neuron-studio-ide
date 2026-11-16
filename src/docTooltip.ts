import type {IMarkdownString} from 'monaco-editor'

// Docstrings come from arbitrary Python files. Only markup generated here is used.
function prose(text: string): string {
  return text.replace(/[\\`*_{}\[\]()#+.!|~<>-]/g, '\\$&')
}

function codeBlock(lines: string[], language: string): string {
  const text = lines.join('\n')
  const indent = Math.min(...lines.filter(line => line.trim()).map(line => line.search(/\S/)))
  const fence = '~'.repeat(Math.max(3, ...Array.from(text.matchAll(/~+/g), m => m[0].length + 1)))
  return [fence + language, ...lines.map(line => line.slice(indent)), fence].join('\n')
}

export function documentation(doc: string): IMarkdownString {
  const lines = doc.replace(/\r\n?/g, '\n').trimEnd().split('\n')
  const blocks: string[] = []
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length) blocks.push(prose(paragraph.join(' ')))
    paragraph = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], value = line.trim()
    if (!value) { flush(); continue }
    if (/^([*=\-~^])\1{2,}$/.test(lines[i + 1]?.trim() ?? '')) {
      flush(); blocks.push('### ' + prose(value)); i++; continue
    }
    const signature = i === 0 && /^(?:class |def |async def )?[\w.]+\(/.test(value)
    const doctest = /^>>>\s/.test(value)
    if (/^\s/.test(line) || doctest || signature) {
      flush()
      const group = [line]
      while (i + 1 < lines.length && lines[i + 1].trim() &&
             (/^\s/.test(lines[i + 1]) || doctest)) {
        group.push(lines[++i])
      }
      blocks.push(codeBlock(group, /^\s*\w+\s*(?:::=|:\s{2,})/.test(line) ? 'text' : 'python'))
    } else {
      paragraph.push(value)
    }
  }
  flush()
  return {value: blocks.join('\n\n'), isTrusted: false, supportHtml: false, supportThemeIcons: false}
}
