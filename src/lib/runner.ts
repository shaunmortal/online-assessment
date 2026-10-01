import type { CodeLang, TestCase } from '../data/paper'

// Runs candidate JavaScript in a throwaway Web Worker (no DOM, killed on timeout).
const WORKER_SOURCE = `
self.onmessage = (event) => {
  const { code, input } = event.data
  const lines = String(input).split('\\n')
  let cursor = 0
  const out = []
  const readLine = () => (cursor < lines.length ? lines[cursor++] : '')
  const print = (...args) => out.push(args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' '))
  const sandboxConsole = { log: print, error: print, info: print, warn: print }
  try {
    new Function('readLine', 'console', code)(readLine, sandboxConsole)
    self.postMessage({ ok: true, output: out.join('\\n') })
  } catch (error) {
    self.postMessage({ ok: false, output: out.join('\\n'), error: String(error && error.message || error) })
  }
}`

let workerUrl: string | undefined

export interface RunResult { ok: boolean; output: string; error?: string; ms: number }

export function runJs(code: string, input: string, timeoutMs = 2000): Promise<RunResult> {
  workerUrl ??= URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }))
  const worker = new Worker(workerUrl)
  const started = performance.now()
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      worker.terminate()
      resolve({ ok: false, output: '', error: `Time limit exceeded (${timeoutMs} ms)`, ms: timeoutMs })
    }, timeoutMs)
    worker.onmessage = (event: MessageEvent<Omit<RunResult, 'ms'>>) => {
      window.clearTimeout(timer)
      worker.terminate()
      resolve({ ...event.data, ms: Math.round(performance.now() - started) })
    }
    worker.postMessage({ code, input })
  })
}

// Python: real CPython (Pyodide) in a long-lived worker, loaded from the CDN on first use.
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/'
const PY_SOURCE = `
importScripts('${PYODIDE}pyodide.js')
loadPyodide({ indexURL: '${PYODIDE}' }).then((py) => {
  self.postMessage({ type: 'ready' })
  self.onmessage = (event) => {
    const { id, code, input } = event.data
    py.globals.set('__src', code)
    py.globals.set('__stdin_text', input)
    try {
      const result = py.runPython(\`
import sys, io, traceback
_out = io.StringIO()
_err = None
sys.stdin, sys.stdout, sys.stderr = io.StringIO(__stdin_text), _out, _out
try:
    exec(compile(__src, '<solution>', 'exec'), {'__name__': '__main__'})
except BaseException:
    _err = traceback.format_exc(limit=-2)
finally:
    sys.stdout, sys.stderr = sys.__stdout__, sys.__stderr__
(_out.getvalue(), _err)
\`).toJs()
      self.postMessage({ id, ok: !result[1], output: result[0].replace(/\\n$/, ''), error: result[1] || undefined })
    } catch (error) {
      self.postMessage({ id, ok: false, output: '', error: String(error) })
    }
  }
}, (error) => self.postMessage({ type: 'load-error', error: String(error) }))`

let python: { worker: Worker; ready: Promise<void> } | undefined
let pythonReady = false

function pythonWorker() {
  if (python) return python
  const worker = new Worker(URL.createObjectURL(new Blob([PY_SOURCE], { type: 'text/javascript' })))
  const ready = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Python runtime took too long to load (check internet access to cdn.jsdelivr.net)')), 60_000)
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'ready' && event.data?.type !== 'load-error') return
      window.clearTimeout(timer)
      worker.removeEventListener('message', onMessage)
      if (event.data.type === 'ready') { pythonReady = true; resolve() }
      else reject(new Error(event.data.error))
    }
    worker.addEventListener('message', onMessage)
    worker.onerror = () => { window.clearTimeout(timer); reject(new Error('Python runtime could not be downloaded')) }
  })
  const handle = { worker, ready }
  python = handle
  ready.catch(() => { worker.terminate(); if (python === handle) python = undefined })
  return handle
}

export const pythonLoaded = () => pythonReady

export async function runPy(code: string, input: string, timeoutMs = 4000): Promise<RunResult> {
  let handle: NonNullable<typeof python>
  try {
    handle = pythonWorker()
    await handle.ready
  } catch (error) {
    return { ok: false, output: '', error: `Python runtime unavailable: ${error instanceof Error ? error.message : error}`, ms: 0 }
  }
  const started = performance.now()
  const id = Math.random()
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      handle.worker.terminate() // an infinite loop can only be stopped by killing the runtime
      if (python === handle) { python = undefined; pythonReady = false }
      resolve({ ok: false, output: '', error: `Time limit exceeded (${timeoutMs} ms)`, ms: timeoutMs })
    }, timeoutMs)
    const onMessage = (event: MessageEvent) => {
      if (event.data?.id !== id) return
      window.clearTimeout(timer)
      handle.worker.removeEventListener('message', onMessage)
      resolve({ ok: event.data.ok, output: event.data.output, error: event.data.error, ms: Math.round(performance.now() - started) })
    }
    handle.worker.addEventListener('message', onMessage)
    handle.worker.postMessage({ id, code, input })
  })
}

export interface CaseResult extends RunResult { input: string; expected: string; passed: boolean }

export async function runCases(lang: CodeLang, program: string, cases: TestCase[]): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  for (const test of cases) {
    const result = lang === 'py' ? await runPy(program, test.input) : await runJs(program, test.input)
    results.push({ ...result, input: test.input, expected: test.output, passed: result.ok && result.output.trim() === test.output.trim() })
  }
  return results
}
