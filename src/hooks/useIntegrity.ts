import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuditEvent, AuditKind, CandidateSlice } from '../lib/core'

type MediaStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'unavailable'
type Signal = (title: string, detail: string, kind?: AuditKind, data?: AuditEvent['data']) => void

export function useIntegrity(onSignal: Signal) {
  const [mediaStatus, setMediaStatus] = useState<MediaStatus>('idle')
  const [mediaMessage, setMediaMessage] = useState('Camera and microphone stay off until you enable them.')
  const [faces, setFaces] = useState<number | null>(null) // stable on-device face count; null until the detector runs
  const [faceError, setFaceError] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(() => Boolean(document.fullscreenElement))
  const [audioLevel, setAudioLevel] = useState(0)
  const [obstructed, setObstructed] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const signalRef = useRef(onSignal)
  const recentRef = useRef(new Map<string, number>())
  const stoppingRef = useRef(false)

  useEffect(() => { signalRef.current = onSignal }, [onSignal])

  const signal = useCallback<Signal>((title, detail, kind, data) => {
    const last = recentRef.current.get(title) ?? 0
    if (Date.now() - last < 1500) return
    recentRef.current.set(title, Date.now())
    signalRef.current(title, detail, kind, data)
  }, [])

  const stopMedia = useCallback(() => {
    stoppingRef.current = true
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setAudioLevel(0)
  }, [])

  useEffect(() => stopMedia, [stopMedia])

  // Callback ref: whichever <video> is mounted shows the live stream.
  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    if (node) {
      videoRef.current = node
      if (streamRef.current) {
        node.srcObject = streamRef.current
        void node.play().catch(() => undefined)
      }
    }
  }, [])

  // Mic level meter.
  useEffect(() => {
    const stream = streamRef.current
    if (mediaStatus !== 'ready' || !stream?.getAudioTracks().length || !window.AudioContext) return
    const context = new AudioContext()
    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    const source = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()))
    source.connect(analyser)
    const samples = new Uint8Array(analyser.frequencyBinCount)
    let frame = 0
    const loop = () => {
      analyser.getByteTimeDomainData(samples)
      setAudioLevel(Math.min(1, samples.reduce((sum, value) => sum + Math.abs(value - 128), 0) / samples.length / 28))
      frame = requestAnimationFrame(loop)
    }
    void context.resume().catch(() => undefined)
    loop()
    return () => {
      cancelAnimationFrame(frame)
      source.disconnect()
      void context.close().catch(() => undefined)
    }
  }, [mediaStatus])

  const requestMedia = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaStatus('unavailable')
      setMediaMessage('This browser cannot provide camera access (needs HTTPS or localhost). Request assisted review.')
      signal('Camera and microphone unavailable', 'The browser does not expose getUserMedia. Assisted review remains available.')
      return
    }
    stopMedia()
    stoppingRef.current = false
    setMediaStatus('requesting')
    setMediaMessage('Waiting for your browser permission…')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => undefined)
      }
      const onEnded = (label: 'Camera' | 'Microphone') => {
        if (stoppingRef.current || streamRef.current !== stream) return
        stopMedia()
        setMediaStatus('unavailable')
        setFaces(null)
        setMediaMessage(`${label} disconnected. Reconnect it to continue monitoring; your answers are safe.`)
        signal(`${label} stream ended`, `The ${label.toLowerCase()} track ended (device unplugged, permission revoked, or used by another app). Answers and timer unaffected.`)
      }
      stream.getVideoTracks().forEach((track) => track.addEventListener('ended', () => onEnded('Camera')))
      stream.getAudioTracks().forEach((track) => track.addEventListener('ended', () => onEnded('Microphone')))
      setMediaStatus('ready')
      setMediaMessage('Camera preview and microphone are live.')
      signal('Camera and microphone connected', 'Candidate granted browser access; live preview and mic meter started.')
    } catch (error) {
      const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      setMediaStatus(denied ? 'denied' : 'unavailable')
      setMediaMessage(denied ? 'Permission was not granted. Allow camera + mic in the address bar and retry, or request assisted review.' : 'No usable camera/microphone found. Connect one and retry, or request assisted review.')
      signal(denied ? 'Camera/mic permission denied' : 'Camera/mic device unavailable', 'Readiness could not start; assisted review remains available.')
    }
  }, [signal, stopMedia])

  const grab = useCallback((width: number, height: number) => {
    const video = videoRef.current
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return null
    const canvas = (canvasRef.current ??= document.createElement('canvas'))
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.drawImage(video, 0, 0, width, height)
    return { context, canvas }
  }, [])

  const captureJpeg = useCallback(() => grab(640, 480)?.canvas.toDataURL('image/jpeg', 0.8) ?? null, [grab])

  // Local obstruction check: a covered lens gives a dark, flat frame.
  useEffect(() => {
    if (mediaStatus !== 'ready') return
    let wasObstructed = false
    const timer = window.setInterval(() => {
      const frame = grab(32, 24)
      if (!frame) return
      const { data } = frame.context.getImageData(0, 0, 32, 24)
      let sum = 0
      let sumSq = 0
      for (let i = 0; i < data.length; i += 4) {
        const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
        sum += luma
        sumSq += luma * luma
      }
      const count = data.length / 4
      const mean = sum / count
      const std = Math.sqrt(Math.max(0, sumSq / count - mean * mean))
      const covered = mean < 22 || std < 5
      if (covered !== wasObstructed) {
        wasObstructed = covered
        setObstructed(covered)
        if (covered) signal('Camera view covered or too dark', `Local frame check: brightness ${Math.round(mean)}, contrast ${Math.round(std)}. Review-only signal.`, 'integrity', { mean: Math.round(mean), std: Math.round(std) })
        else signal('Camera view clear again', 'The local frame check sees a normal image again.')
      }
    }, 2500)
    return () => window.clearInterval(timer)
  }, [mediaStatus, grab, signal])

  // On-device face monitor (MediaPipe BlazeFace, wasm + model served from this app, works offline).
  // Samples ~1.5x per second; a count must hold for ~2 s before it becomes the stable value.
  useEffect(() => {
    if (mediaStatus !== 'ready') return
    let alive = true
    let timer: number | undefined
    let detector: { detectForVideo: (video: HTMLVideoElement, at: number) => { detections: unknown[] }; close: () => void } | undefined
    let candidate = -1
    let streak = 0
    let stable: number | null = null
    void import('@mediapipe/tasks-vision').then(async ({ FaceDetector, FilesetResolver }) => {
      // The 11 MB wasm comes from jsDelivr first (fast everywhere); our own copy is the fallback for
      // centres that block CDNs. Keep the version equal to the pinned package in package.json.
      const create = async (base: string) => FaceDetector.createFromOptions(await FilesetResolver.forVisionTasks(base), {
        baseOptions: { modelAssetPath: '/models/blaze_face_short_range.tflite' },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.45,
      })
      const created = await create('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm').catch(() => create('/mediapipe'))
      if (!alive) return created.close()
      detector = created
      const sample = () => {
        const video = videoRef.current
        if (detector && video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth) {
          const count = detector.detectForVideo(video, performance.now()).detections.length
          streak = count === candidate ? streak + 1 : 1
          candidate = count
          if (streak >= 3 && count !== stable) {
            const previous = stable
            stable = count
            setFaces(count)
            if (count >= 2) signal(`Multiple faces in view (${count})`, `On-device face monitor saw ${count} faces for about 2 seconds. Review-only; AI frame check requested.`, 'ai', { faces: count, source: 'on-device' })
            else if (count === 0 && previous !== null) signal('No face in view', 'On-device face monitor could not see the candidate for about 2 seconds. Review-only.', 'ai', { faces: 0, source: 'on-device' })
            else if (count === 1 && previous !== null && previous !== 1) signal('Single face in view again', 'On-device face monitor sees exactly one face again.', 'ai', { faces: 1, source: 'on-device' })
            onFaceAlert.current?.(count)
          }
        }
        timer = window.setTimeout(sample, 650)
      }
      sample()
    }).catch(() => alive && setFaceError('Face monitor could not start on this browser.'))
    return () => {
      alive = false
      window.clearTimeout(timer)
      detector?.close()
      setFaces(null)
    }
  }, [mediaStatus, signal])

  // Lets the AI proctor react immediately when the face count changes.
  const onFaceAlert = useRef<((count: number) => void) | undefined>(undefined)

  const requestFullscreen = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen()
    } catch {
      signal('Fullscreen not entered', 'The browser refused or the candidate cancelled fullscreen.')
    }
  }, [signal])

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  return {
    mediaStatus, mediaMessage, faces, faceError, isFullscreen, audioLevel, obstructed,
    attachVideo, requestMedia, requestFullscreen, captureJpeg, signal, onFaceAlert,
  }
}

export type Integrity = ReturnType<typeof useIntegrity>

// Periodically sends one downscaled webcam frame to /api/proctor (Claude vision, server-side key).
export function useAiProctor(options: {
  active: boolean
  candidateId?: string
  captureJpeg: () => string | null
  onStatus: (ai: CandidateSlice['ai']) => void
  onSignal: Signal
}) {
  const [config, setConfig] = useState<{ enabled: boolean; model?: string; intervalSeconds: number } | null>(null)
  const optionsRef = useRef(options)
  const checksRef = useRef(0)
  const lastRiskRef = useRef<string>('none')
  const failingRef = useRef(false)
  const lastSentRef = useRef(0)
  useEffect(() => { optionsRef.current = options })

  useEffect(() => {
    fetch('/api/proctor/status', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((value) => setConfig(value ?? { enabled: false, intervalSeconds: 20 }))
      .catch(() => setConfig({ enabled: false, intervalSeconds: 20 }))
  }, [])

  const checkNow = useCallback(async (reason = 'scheduled') => {
    const { candidateId, captureJpeg, onStatus, onSignal } = optionsRef.current
    if (Date.now() - lastSentRef.current < 5000) return // server allows one frame per 4 s per candidate
    const image = captureJpeg()
    if (!candidateId || !image) return
    lastSentRef.current = Date.now()
    try {
      const response = await fetch('/api/proctor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId, image, reason }),
      })
      const body = await response.json()
      if (!response.ok) {
        if (response.status === 429) return
        const error = body.error ?? `HTTP ${response.status}`
        onStatus({ checks: checksRef.current, lastAt: new Date().toISOString(), error })
        if (!failingRef.current) onSignal('AI proctor unavailable', `${error} Frames are not being reviewed until it recovers.`, 'ai', { reason })
        failingRef.current = true
        return
      }
      if (failingRef.current) onSignal('AI proctor available again', 'Frame review resumed.', 'ai', { reason })
      failingRef.current = false
      const verdict = body.verdict as {
        faces_visible: number; candidate_present: boolean; looking_away: boolean; phone_or_device_visible: boolean
        another_person_visible: boolean; camera_obstructed: boolean; risk: 'none' | 'low' | 'medium' | 'high'; summary: string
      }
      checksRef.current += 1
      onStatus({ checks: checksRef.current, lastAt: new Date().toISOString(), risk: verdict.risk, summary: verdict.summary, faces: verdict.faces_visible })
      const findings = [
        verdict.faces_visible > 1 || verdict.another_person_visible ? `${Math.max(2, verdict.faces_visible)} people in view` : '',
        verdict.phone_or_device_visible ? 'phone or device visible' : '',
        verdict.camera_obstructed ? 'camera obstructed' : '',
        verdict.faces_visible === 0 ? 'no candidate in view' : '',
        verdict.looking_away ? 'looking away from screen' : '',
      ].filter(Boolean)
      if (verdict.risk !== 'none' || findings.length) {
        onSignal(`AI proctor: ${findings[0] ?? `${verdict.risk} risk`}`, `${verdict.summary} (${body.model}, ${body.ms} ms). Review-only; a human officer decides.`, 'ai', {
          risk: verdict.risk, faces: verdict.faces_visible, device: verdict.phone_or_device_visible, otherPerson: verdict.another_person_visible, lookingAway: verdict.looking_away, obstructed: verdict.camera_obstructed, reason,
        })
      } else if (lastRiskRef.current !== 'none') {
        onSignal('AI proctor: view normal again', `${verdict.summary} (${body.model}).`, 'ai', { risk: 'none', faces: verdict.faces_visible, reason })
      }
      lastRiskRef.current = verdict.risk
    } catch {
      onStatus({ checks: checksRef.current, lastAt: new Date().toISOString(), error: 'AI proctor unreachable (network or server down).' })
      if (!failingRef.current) onSignal('AI proctor unavailable', 'The proctor endpoint could not be reached.', 'ai', { reason })
      failingRef.current = true
    }
  }, [])

  useEffect(() => {
    if (!options.active || !config?.enabled) return
    const first = window.setTimeout(() => void checkNow('session-start'), 3000)
    const timer = window.setInterval(() => void checkNow(), config.intervalSeconds * 1000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [options.active, config, checkNow])

  return { config, checkNow }
}
