import type { GameDatabase } from '../db.js'
import { esc } from '../html.js'
import type { Session } from '../session.js'
import { meta } from './psql.js'

const REFUSED = /^\s*(reset|set\s+(role|session)|begin|start|commit|end|rollback|abort|savepoint|release)\b/i

type ResultRow = Record<string, unknown>
type TableResult = {
  title: string
  rows: ResultRow[]
  link?: { column: string; command: string }
  pre?: boolean
}

export function mountConsole({
  input,
  output,
  db,
  session,
  history,
  schedule,
}: {
  input: HTMLInputElement
  output: HTMLElement
  db: GameDatabase
  session: Session
  history: { add(who: string, sql: string): void }
  schedule: (fn: () => Promise<void>) => void
}): { isTyping: () => boolean } {
  const run = (text: string): void => schedule(() => runNow(text))

  async function runNow(text: string): Promise<void> {
    if (!text.trim()) {
      return
    }
    history.add('you', text)
    if (REFUSED.test(text)) {
      output.innerHTML = '<p class="err">Refused by the page: PGlite runs as superuser under SET ROLE, so role and transaction changes would be a real escape.</p>'
      return
    }
    try {
      const results = await session.attempt(async () =>
        text.startsWith('\\')
          ? meta(db, text)
          : db.rows(text).then((rows) => [{ title: `${rows.length} rows`, rows }]))
      output.innerHTML = results.map(table).join('')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      output.innerHTML = `<p class="err">ERROR: ${esc(message)}</p>`
    }
  }

  const typed: string[] = []
  let cursor = 0

  input.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      cursor = Math.max(0, Math.min(typed.length, cursor + (event.key === 'ArrowUp' ? -1 : 1)))
      input.value = typed[cursor] ?? ''
    } else if (event.key === 'Enter') {
      const text = input.value
      if (text.trim()) {
        typed.push(text)
      }
      cursor = typed.length
      input.value = ''
      run(text)
    }
  })

  output.addEventListener('click', (event: MouseEvent) => {
    const target = event.target as HTMLElement | null
    const cmd = target?.dataset?.run
    if (!cmd) {
      return
    }
    event.preventDefault()
    run(cmd)
  })

  return { isTyping: () => document.activeElement === input }
}

function table({ title, rows, link, pre }: TableResult): string {
  const heading = `<h4>${esc(title)}</h4>`
  if (!rows.length) {
    return `${heading}<p>(no rows)</p>`
  }
  if (pre) {
    return `${heading}<pre>${esc(Object.values(rows[0])[0])}</pre>`
  }

  const cols = Object.keys(rows[0])
  const cell = (column: string, value: unknown): string => {
    const text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
    return link?.column === column
      ? `<a href="#" data-run="${esc(`${link.command} ${text}`)}">${esc(text)}</a>`
      : esc(text)
  }
  return `${heading}<table>
    <tr>${cols.map((column) => `<th>${esc(column)}</th>`).join('')}</tr>
    ${rows.map((row) => `<tr>${cols.map((column) => `<td>${cell(column, row[column])}</td>`).join('')}</tr>`).join('')}
  </table>`
}
