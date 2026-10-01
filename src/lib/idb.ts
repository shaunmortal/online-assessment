import type { Checkpoint, ExamState } from './core'

// IndexedDB is the durable local answer store: it survives reloads, crashes and
// outages even when localStorage is cleared.
const DB_NAME = 'examshield'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is not available in this browser'))
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('kv')
      request.result.createObjectStore('checkpoints', { keyPath: 'id' })
    }
    request.onsuccess = () => {
      // Let another tab or a wipe delete/upgrade the database instead of being blocked by us.
      request.result.onversionchange = () => { request.result.close(); dbPromise = undefined }
      resolve(request.result)
    }
    request.onerror = () => reject(request.error)
  })
}

let dbPromise: Promise<IDBDatabase> | undefined
const db = () => (dbPromise ??= open().catch((error) => { dbPromise = undefined; throw error }))

async function run<T>(store: string, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await db()
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store, mode)
    const request = action(tx.objectStore(store))
    tx.oncomplete = () => resolve(request.result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export const putCheckpoint = (checkpoint: Checkpoint) => run('checkpoints', 'readwrite', (s) => s.put(checkpoint))
export const saveSnapshot = (state: ExamState) => run('kv', 'readwrite', (s) => s.put(state, 'state'))
export const loadSnapshot = () => run<ExamState | undefined>('kv', 'readonly', (s) => s.get('state'))

// Real write → read → delete round trip used by the readiness gate.
export async function probeSaveChannel() {
  const started = performance.now()
  const token = `probe-${Math.random()}`
  await run('kv', 'readwrite', (s) => s.put(token, 'probe'))
  const read = await run<string>('kv', 'readonly', (s) => s.get('probe'))
  await run('kv', 'readwrite', (s) => s.delete('probe'))
  if (read !== token) throw new Error('Save channel returned a different value than written')
  return Math.round(performance.now() - started)
}
