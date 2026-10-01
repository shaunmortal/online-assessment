import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

/* Exam sessions as a network of nodes around a central shield lattice.
   Every few seconds a cluster loses its link (flicker, dim), then a pulse
   travels from the shield along the chain of links and brings them back. */

const N = 170
const GOLD = new THREE.Color('#e9c46a')
const ROYAL = new THREE.Color('#5b7fe6')
const LOST = new THREE.Color('#7a2a22')
const LINE = new THREE.Color('#2b4fb8').multiplyScalar(0.28)
const SEG_SECONDS = 0.32

type Handle = { dispose(): void; setRunning(on: boolean): void; pointer(x: number, y: number): void; scroll(y: number): void }
export type Status = { phase: 'idle' | 'flicker' | 'pulse'; count: number }

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function build(canvas: HTMLCanvasElement, host: HTMLElement, reduced: boolean, onStatus: (s: Status) => void): Handle | null {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
  } catch {
    return null
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60)
  camera.position.set(0, 0.4, 13)
  const group = new THREE.Group()
  scene.add(group)

  const rnd = mulberry(7)
  // ---- nodes: a flattened shell around the shield
  const pos = new Float32Array((N + 1) * 3)
  const base: THREE.Color[] = []
  const phase = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const r = 3.1 + Math.pow(rnd(), 0.7) * 3.6
    const th = rnd() * Math.PI * 2
    const ph = Math.acos(2 * rnd() - 1)
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th)
    pos[i * 3 + 1] = r * Math.cos(ph) * 0.62
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th) * 0.8
    base.push(rnd() < 0.24 ? GOLD.clone() : ROYAL.clone())
    phase[i] = rnd() * Math.PI * 2
  }
  // index N is the shield centre
  const at = (i: number) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])

  // ---- links: 2 nearest neighbours each, plus the innermost nodes to the shield
  const adj: number[][] = Array.from({ length: N + 1 }, () => [])
  const edges: [number, number][] = []
  const edgeId = new Map<string, number>()
  const link = (a: number, b: number) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`
    if (edgeId.has(key)) return
    edgeId.set(key, edges.length)
    edges.push([a, b])
    adj[a].push(b)
    adj[b].push(a)
  }
  const pts = Array.from({ length: N }, (_, i) => at(i))
  for (let i = 0; i < N; i++) {
    const near = pts.map((p, j) => ({ j, d: j === i ? Infinity : p.distanceTo(pts[i]) })).sort((a, b) => a.d - b.d)
    link(i, near[0].j)
    link(i, near[1].j)
  }
  const hubs = pts.map((p, j) => ({ j, d: p.length() })).sort((a, b) => a.d - b.d).slice(0, 14).map((h) => h.j)
  hubs.forEach((h) => link(h, N))

  const sizes = new Float32Array(N)
  const glow = new Float32Array(N)
  const colors = new Float32Array(N * 3)
  for (let i = 0; i < N; i++) sizes[i] = (hubs.includes(i) ? 3.0 : 1.5) + rnd() * 1.6

  const nodeGeo = new THREE.BufferGeometry()
  nodeGeo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, N * 3), 3))
  nodeGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  nodeGeo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1))
  nodeGeo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  const pointMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uDpr: { value: renderer.getPixelRatio() } },
    vertexShader: `
      attribute float aSize; attribute float aGlow; attribute vec3 aColor;
      uniform float uDpr; varying float vGlow; varying vec3 vColor;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (1.0 + aGlow * 0.7) * (52.0 / -mv.z) * uDpr;
        gl_Position = projectionMatrix * mv; vGlow = aGlow; vColor = aColor;
      }`,
    fragmentShader: `
      varying float vGlow; varying vec3 vColor;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard;
        float core = smoothstep(0.42, 0.0, d);
        float halo = smoothstep(1.0, 0.25, d) * 0.3;
        vec3 col = vColor * (0.75 + 0.7 * vGlow) + vec3(core * 0.35);
        gl_FragColor = vec4(col, (core + halo) * (0.45 + 0.55 * vGlow));
      }`,
  })
  group.add(new THREE.Points(nodeGeo, pointMat))

  const linePos = new Float32Array(edges.length * 6)
  const lineCol = new Float32Array(edges.length * 6)
  edges.forEach(([a, b], e) => {
    linePos.set([pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2], pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]], e * 6)
  })
  const lineGeo = new THREE.BufferGeometry()
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3))
  lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3))
  const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  group.add(new THREE.LineSegments(lineGeo, lineMat))
  const edgeGlow = new Float32Array(edges.length)

  // ---- the shield: two nested lattices
  const shield = new THREE.Group()
  const outer = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.45, 1)), new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.55 }))
  const inner = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.85, 0)), new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.9 }))
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 2), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.95 }))
  const haze = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 2), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false }))
  shield.add(outer, inner, core, haze)
  group.add(shield)

  // ---- pulse heads (one per recovering node)
  const MAXP = 8
  const headPos = new Float32Array(MAXP * 3)
  const headGeo = new THREE.BufferGeometry()
  headGeo.setAttribute('position', new THREE.BufferAttribute(headPos, 3))
  headGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MAXP).fill(5.5), 1))
  headGeo.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(MAXP).fill(1.4), 1))
  headGeo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(Array.from({ length: MAXP }, () => [GOLD.r, GOLD.g, GOLD.b]).flat()), 3))
  headGeo.setDrawRange(0, 0)
  group.add(new THREE.Points(headGeo, pointMat))

  // ---- outage / recovery state machine
  type Phase = 'idle' | 'flicker' | 'pulse'
  let phaseName: Phase = 'idle'
  let phaseStart = -1.4
  let targets: number[] = []
  let paths: number[][] = []
  const flashUntil = new Float32Array(N)
  const target = base.map((c) => c.clone())

  const bfsPath = (to: number) => {
    const parent = new Int32Array(N + 1).fill(-1)
    const queue = [N]
    parent[N] = N
    while (queue.length) {
      const u = queue.shift()!
      if (u === to) break
      for (const v of adj[u]) if (parent[v] === -1) { parent[v] = u; queue.push(v) }
    }
    const path = [to]
    while (path[0] !== N && parent[path[0]] !== -1) path.unshift(parent[path[0]])
    return path[0] === N ? path : [N, to]
  }

  const startOutage = (t: number) => {
    const inner = pts.map((p, j) => ({ j, d: p.length() })).filter((o) => o.d < 5.2)
    const seed = inner[Math.floor(Math.random() * inner.length)].j
    const set = new Set<number>([seed])
    for (const v of adj[seed]) if (v !== N) set.add(v)
    for (const v of [...set]) for (const w of adj[v]) if (w !== N && set.size < 6) set.add(w)
    targets = [...set]
    targets.forEach((i) => target[i].copy(LOST))
    phaseName = 'flicker'
    phaseStart = t
    onStatus({ phase: 'flicker', count: targets.length })
  }

  const step = (t: number, dt: number) => {
    const el = t - phaseStart
    if (phaseName === 'idle' && el > 2.2) startOutage(t)
    else if (phaseName === 'flicker') {
      const dark = Math.min(1, el / 2.2)
      const tick = Math.floor(t * 14)
      targets.forEach((i, k) => { glow[i] = (tick + k) % 3 === 0 && Math.random() < 1 - dark ? 0.9 : 0.02 })
      if (el > 2.4) {
        paths = targets.map(bfsPath)
        phaseName = 'pulse'
        phaseStart = t
        onStatus({ phase: 'pulse', count: targets.length })
      }
    } else if (phaseName === 'pulse') {
      let count = 0
      let longest = 0
      paths.forEach((p, k) => {
        const L = p.length - 1
        longest = Math.max(longest, L)
        const s = el / SEG_SECONDS
        if (s >= L) return
        const seg = Math.floor(s)
        const a = at(p[seg]), b = at(p[seg + 1])
        a.lerp(b, s - seg)
        headPos.set([a.x, a.y, a.z], count * 3)
        count++
        const e = edgeId.get(p[seg] < p[seg + 1] ? `${p[seg]}-${p[seg + 1]}` : `${p[seg + 1]}-${p[seg]}`)
        if (e !== undefined) edgeGlow[e] = 1
        const arrivedAt = p[seg]
        if (arrivedAt !== N && flashUntil[arrivedAt] < t) { flashUntil[arrivedAt] = t + 0.9; target[arrivedAt].copy(GOLD) }
        if (s - seg > 0.85) {
          const nxt = p[seg + 1]
          if (flashUntil[nxt] < t) { flashUntil[nxt] = t + 1.1; target[nxt].copy(GOLD) }
        }
      })
      headGeo.setDrawRange(0, count)
      headGeo.attributes.position.needsUpdate = true
      if (el > longest * SEG_SECONDS + 1.2) {
        targets.forEach((i) => target[i].copy(base[i]))
        targets = []
        headGeo.setDrawRange(0, 0)
        phaseName = 'idle'
        phaseStart = t
        onStatus({ phase: 'idle', count: 0 })
      }
    }
    // node colour + twinkle
    const tmp = new THREE.Color()
    for (let i = 0; i < N; i++) {
      const lost = targets.includes(i) && phaseName === 'flicker'
      if (flashUntil[i] > t) { glow[i] = 1.6 * Math.min(1, (flashUntil[i] - t) / 0.4 + 0.4) }
      else if (!lost) glow[i] += ((0.35 + 0.35 * Math.sin(t * 0.8 + phase[i])) - glow[i]) * Math.min(1, dt * 3)
      if (flashUntil[i] < t && flashUntil[i] > 0 && !targets.includes(i)) target[i].copy(base[i])
      tmp.set(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]).lerp(target[i], Math.min(1, dt * 4))
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b
    }
    nodeGeo.attributes.aGlow.needsUpdate = true
    nodeGeo.attributes.aColor.needsUpdate = true
    for (let e = 0; e < edges.length; e++) {
      edgeGlow[e] = Math.max(0, edgeGlow[e] - dt * 0.6)
      const [a, b] = edges[e]
      const lostEdge = phaseName === 'flicker' && (targets.includes(a) || targets.includes(b))
      tmp.copy(lostEdge ? LOST : LINE).lerp(GOLD, edgeGlow[e])
      lineCol.set([tmp.r, tmp.g, tmp.b, tmp.r, tmp.g, tmp.b], e * 6)
    }
    lineGeo.attributes.color.needsUpdate = true
    shield.rotation.y += dt * 0.12
    shield.rotation.x = Math.sin(t * 0.2) * 0.25
    inner.rotation.y -= dt * 0.3
    inner.rotation.z += dt * 0.18
  }

  // initial colours
  for (let i = 0; i < N; i++) colors.set([base[i].r, base[i].g, base[i].b], i * 3)

  // ---- layout, parallax, loop
  let px = 0, py = 0, sy = 0
  const rot = { x: 0, y: 0 }
  const layout = () => {
    const w = host.clientWidth || 1, h = host.clientHeight || 1
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    const wide = w > 880
    group.position.x = wide ? 2.6 : 0
    group.position.y = wide ? 0 : 3.1
    const s = wide ? Math.min(0.92, w / 1500 + 0.2) : Math.min(0.64, w / 600)
    group.scale.setScalar(s)
  }
  layout()
  const ro = new ResizeObserver(layout)
  ro.observe(host)

  let raf = 0
  let running = false
  let last = performance.now()
  let t = 0
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    t += dt
    step(t, dt)
    rot.y += (px * 0.35 - rot.y) * 0.04
    rot.x += (py * 0.2 - rot.x) * 0.04
    group.rotation.y = rot.y + t * 0.025
    group.rotation.x = rot.x
    camera.position.y = 0.4 - sy * 0.0022
    renderer.render(scene, camera)
    if (running) raf = requestAnimationFrame(frame)
  }
  if (reduced) {
    for (let i = 0; i < 40; i++) step(i * 0.1, 0.1)
    renderer.render(scene, camera)
  }

  return {
    setRunning(on) {
      if (reduced) return
      if (on && !running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame) }
      if (!on && running) { running = false; cancelAnimationFrame(raf) }
    },
    pointer(x, y) { px = x; py = y },
    scroll(y) { sy = y },
    dispose() {
      running = false
      cancelAnimationFrame(raf)
      ro.disconnect()
      scene.traverse((o) => {
        const m = o as THREE.Mesh
        m.geometry?.dispose()
        const mat = m.material as THREE.Material | undefined
        mat?.dispose()
      })
      renderer.dispose()
    },
  }
}

const STATIC = (() => {
  const r = mulberry(3)
  return Array.from({ length: 60 }, () => ({ x: 120 + r() * 560, y: 60 + r() * 300, s: 1 + r() * 2.2, g: r() < 0.3 }))
})()

function StaticScene() {
  return (
    <svg className="lp-hero-static" viewBox="0 0 800 420" aria-hidden="true">
      {STATIC.slice(0, 40).map((p, i) => {
        const q = STATIC[(i * 7 + 3) % STATIC.length]
        return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#2b4fb8" strokeOpacity=".35" />
      })}
      {STATIC.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={p.s} fill={p.g ? '#e9c46a' : '#5b7fe6'} />)}
      <polygon points="400,150 452,180 452,240 400,270 348,240 348,180" fill="none" stroke="#e9c46a" strokeWidth="1.5" />
      <polygon points="400,180 426,195 426,225 400,240 374,225 374,195" fill="none" stroke="#e9c46a" strokeWidth="1.5" />
      <circle cx="400" cy="210" r="6" fill="#e9c46a" />
    </svg>
  )
}

const STATUS: Record<Status['phase'], (n: number) => string> = {
  idle: () => 'All sessions in sync · evidence chain intact',
  flicker: (n) => `Outage detected · ${n} sessions lost heartbeat · timers still running`,
  pulse: (n) => `Reconnecting · syncing answers from ${n} devices along the chain`,
}

export default function Hero3D() {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const caption = useRef<HTMLParagraphElement>(null)
  const [fallback, setFallback] = useState(false)

  useEffect(() => {
    const el = host.current, cv = canvas.current
    if (!el || !cv) return
    const probe = document.createElement('canvas')
    if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) { setFallback(true); return }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const h = build(cv, el, reduced, (s) => {
      const c = caption.current
      if (!c) return
      c.dataset.phase = s.phase
      c.textContent = STATUS[s.phase](s.count)
    })
    if (!h) { setFallback(true); return }

    let visible = true
    const sync = () => h.setRunning(visible && document.visibilityState === 'visible')
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync() }, { threshold: 0.02 })
    io.observe(el)
    const onVis = () => sync()
    const onMove = (e: PointerEvent) => h.pointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1)
    const onScroll = () => h.scroll(window.scrollY)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    sync()
    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('scroll', onScroll)
      h.dispose()
    }
  }, [])

  return (
    <>
      <div ref={host} className="lp-hero3d" role="img" aria-label="Animated network of exam sessions around a central shield; a few sessions lose connection and are pulled back into sync by a pulse travelling along the links.">
        {fallback ? <StaticScene /> : <canvas ref={canvas} />}
      </div>
      {!fallback && <p ref={caption} className="lp-hero-status lp-mono" data-phase="idle" aria-live="off">All sessions in sync · evidence chain intact</p>}
    </>
  )
}
