// Only buffer a potential frame. Ordinary output (including prompts) appears immediately.
export function splitOutput(write: (s: string) => void, frame: (s: string) => boolean) {
  const prefixes = ['@live ', '@neuron ']
  let buffer = '', ordinary = false
  function push(chunk: string) {
    for (const part of chunk.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
      const end = part.endsWith('\n')
      if (ordinary) write(part)
      else {
        buffer += part
        if (end) {
          if (!prefixes.some(p => buffer.startsWith(p)) || !frame(buffer.trimEnd())) write(buffer)
          buffer = ''
        } else if (!prefixes.some(p => p.startsWith(buffer) || buffer.startsWith(p)) || buffer.length > 2097152) {
          write(buffer)
          buffer = ''
          ordinary = true
        }
      }
      if (end) ordinary = false
    }
  }
  return {push, finish() { if (buffer && !frame(buffer)) write(buffer); buffer = '' }}
}
