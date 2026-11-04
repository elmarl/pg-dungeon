import type { GameDatabase } from '../db.js'
import { escapeHtml } from '../html.js'
import type { Session } from '../session.js'
import { runPsqlCommand } from './psql.js'

const REFUSED = /^\s*(?:reset\b|set\s+(?:role|session)\b|begin\b|start\b|commit\b|end\b|rollback\b|abort\b|savepoint\b|release\b)/i
const QUOTED_VALUE = /'(?:''|[^'])*'|"(?:""|[^"])*"/g

export function isRefusedCommand(text: string): boolean {
  const sql = text.replace(QUOTED_VALUE, ' ')
  if (sql.includes('--') || sql.includes('/*')) {
    return true
  }

  const statements = sql.split(';').filter((statement) => statement.trim())
  return statements.length > 1 || statements.some((statement) => REFUSED.test(statement))
}

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
  input: HTMLTextAreaElement
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
    if (isRefusedCommand(text)) {
      output.innerHTML = '<p class="err">Refused by the page: SQL comments, multiple statements, and transaction control are not allowed.</p>'
      return
    }
    try {
      if (text.trim() === '\\rewind') {
        await session.rewind()
        const status = await db.rows('select turn, rewinds from screen.status')
        output.innerHTML = renderConsoleResult({ title: 'Rewind', rows: status })
        return
      }

      const results = await session.executeCommand(async () => {
        if (text.startsWith('\\')) {
          return runPsqlCommand(db, text)
        }
        return db.rows(text).then((rows) => [{ title: `${rows.length} rows`, rows }])
      })
      output.innerHTML = results.map(renderConsoleResult).join('')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      output.innerHTML = `<p class="err">ERROR: ${escapeHtml(message)}</p>`
    }
  }

  const typed: string[] = []
  let cursor = 0
  let browsingHistory = false

  input.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.altKey || event.getModifierState('Alt'))) {
      event.preventDefault()
      input.setRangeText('\n', input.selectionStart, input.selectionEnd, 'end')
      browsingHistory = false
      cursor = typed.length
    } else if (
      event.key === 'ArrowUp'
      && input.selectionStart === input.selectionEnd
      && input.value.lastIndexOf('\n', input.selectionStart - 1) === -1
      && typed.length > 0
    ) {
      event.preventDefault()
      if (!browsingHistory) {
        cursor = typed.length
        browsingHistory = true
      }
      cursor = Math.max(0, cursor - 1)
      input.value = typed[cursor] ?? ''
    } else if (
      event.key === 'ArrowDown'
      && browsingHistory
      && input.selectionStart === input.selectionEnd
      && input.value.indexOf('\n', input.selectionStart) === -1
    ) {
      event.preventDefault()
      cursor = Math.min(typed.length, cursor + 1)
      input.value = typed[cursor] ?? ''
      if (cursor === typed.length) {
        browsingHistory = false
      }
    } else if (event.key === 'Enter' && !event.altKey) {
      event.preventDefault()
      const text = input.value
      if (text.trim()) {
        typed.push(text)
      }
      cursor = typed.length
      browsingHistory = false
      input.value = ''
      scheduleConsoleInput(text)
    }
  })

  input.addEventListener('input', () => {
    browsingHistory = false
    cursor = typed.length
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
