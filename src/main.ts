import { openDatabase } from './db.js'
import { startSession } from './session.js'
import { render } from './render.js'
import { listenForKeys } from './input.js'
import { createHistory } from './console/history.js'
import { mountConsole } from './console/console.js'

const getElement = (id: string): HTMLElement | null => document.getElementById(id)

const historyEl = getElement('history')
if (!historyEl) {
  throw new Error('Missing history panel')
}

const history = createHistory(historyEl)
const db = await openDatabase(history)
const session = await startSession(db)
const redraw = (): Promise<void> => render(db, getElement)

let busy: Promise<void> = Promise.resolve()
const serial = <T>(fn: (...args: any[]) => Promise<T> | T) => {
  return (...args: any[]): Promise<void> => {
    busy = busy.then(async () => {
      await Promise.resolve(fn(...args))
      await redraw()
    }).catch((error) => {
      console.error(error)
    })
    return busy
  }
}

const terminal = mountConsole({
  input: getElement('cheat') as HTMLInputElement,
  output: getElement('cheat-out') as HTMLElement,
  db,
  session,
  history,
  schedule: (fn: () => Promise<void>) => serial(fn)(),
})

listenForKeys({
  move: serial(session.move),
  rewind: serial(session.rewind),
  isTyping: terminal.isTyping,
})

await redraw()
const loading = getElement('loading')
if (loading) {
  loading.remove()
}
