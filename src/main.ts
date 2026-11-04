import { openDatabase } from './db.js'
import { startSession } from './session.js'
import { render } from './render.js'
import { createHistory } from './console/history.js'
import { mountConsole } from './console/console.js'

const getElementById = (id: string): HTMLElement | null => document.getElementById(id)

const historyEl = getElementById('history')
if (!historyEl) {
  throw new Error('Missing history panel')
}

const history = createHistory(historyEl)
const db = await openDatabase(history)
const session = await startSession(db)
const redraw = (): Promise<void> => render(db, getElementById)

let busy: Promise<void> = Promise.resolve()
const queueAction = <T>(fn: (...args: any[]) => Promise<T> | T) => {
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

mountConsole({
  input: getElementById('cheat') as HTMLInputElement,
  output: getElementById('cheat-out') as HTMLElement,
  db,
  session,
  history,
  schedule: (fn: () => Promise<void>) => queueAction(fn)(),
})

await redraw()
const loading = getElementById('loading')
if (loading) {
  loading.remove()
}
