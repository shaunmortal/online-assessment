import { lazy, Suspense } from 'react'
import { useExam } from './state'
import { CandidateApp } from './candidate'
import { OpsApp } from './ops'
import { VerifyPage } from './ui'
import { ReportPage } from './analyticsView'

// The marketing page pulls in Three.js, so it loads only on "/".
const Landing = lazy(() => import('./landing/Landing').then(async (module) => {
  await import('./landing/landing.css')
  return module
}))

function ExamRoutes() {
  const api = useExam()
  const path = window.location.pathname
  if (path.startsWith('/ops')) return <OpsApp api={api} />
  if (path.startsWith('/verify')) return <VerifyPage state={api.state} />
  if (path.startsWith('/report')) return <ReportPage state={api.state} />
  return <CandidateApp api={api} />
}

export default function App() {
  const path = window.location.pathname
  if (path === '/' || path === '/index.html') return <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0e1726' }} />}><Landing /></Suspense>
  return <ExamRoutes />
}
