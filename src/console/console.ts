import type { GameDatabase } from '../db.js'
import { escapeHtml } from '../html.js'
import type { Session } from '../session.js'
import { runPsqlCommand } from './psql.js'

const REFUSED = /^\s*(reset|set\s+(role|session)|begin|start|commit|end|rollback|abort|savepoint|release)\b/i

type ResultRow = Record<string, unknown>
type ConsoleResult = {
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
  const scheduleConsoleInput = (text: string): void => schedule(() => executeConsoleInput(text))

  async function executeConsoleInput(text: string): Promise<void> {
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
          ? runPsqlCommand(db, text)
          : db.rows(text).then((rows) => [{ title: `${rows.length} rows`, rows }]))
      output.innerHTML = results.map(renderConsoleResult).join('')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      output.innerHTML = `<p class="err">ERROR: ${escapeHtml(message)}</p>`
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
      scheduleConsoleInput(text)
    }
  })

  output.addEventListener('click', (event: MouseEvent) => {
    const target = event.target as HTMLElement | null
    const cmd = target?.dataset?.run
    if (!cmd) {
      return
    }
    event.preventDefault()
    scheduleConsoleInput(cmd)
  })

  return { isTyping: () => document.activeElement === input }
}

function renderConsoleResult({ title, rows, link, pre }: ConsoleResult): string {
  const heading = `<h4>${escapeHtml(title)}</h4>`
  if (!rows.length) {
    return `${heading}<p>(no rows)</p>`
  }
  if (pre) {
    return `${heading}<pre>${escapeHtml(Object.values(rows[0])[0])}</pre>`
  }

  const cols = Object.keys(rows[0])
  const renderConsoleCell = (column: string, value: unknown): string => {
    const text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
    return link?.column === column
      ? `<a href="#" data-run="${escapeHtml(`${link.command} ${text}`)}">${escapeHtml(text)}</a>`
      : escapeHtml(text)
  }
  return `${heading}<table>
    <tr>${cols.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr>
    ${rows.map((row) => `<tr>${cols.map((column) => `<td>${renderConsoleCell(column, row[column])}</td>`).join('')}</tr>`).join('')}
  </table>`
}
