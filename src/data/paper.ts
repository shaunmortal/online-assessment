import type { Lang } from '../lib/core'

export type SectionId = 'aptitude' | 'technical' | 'coding'

export interface McqQuestion {
  id: string
  section: SectionId
  type: 'mcq'
  text: Record<Lang, { prompt: string; options: string[] }>
  key?: number // present only in the server-side paper
  order?: number[] // per-candidate option shuffle: order[displayed index] = canonical index
  reference?: 'binary-tree'
}

export interface TestCase { input: string; output: string }

export type CodeLang = 'js' | 'py'

export const CODE_LANGS: Record<CodeLang, string> = { js: 'JavaScript (Node 20)', py: 'Python 3.12' }

// What the candidate edits (`code`) and the locked driver that reads stdin, calls it and prints.
export interface CodeTemplate { code: string; driver: string }

export interface CodingQuestion {
  id: string
  section: 'coding'
  type: 'coding'
  text: Record<Lang, { title: string; statement: string; input: string; output: string }>
  samples: TestCase[]
  hidden: TestCase[]
  templates: Record<CodeLang, CodeTemplate>
}

export type Question = McqQuestion | CodingQuestion

export const PAPER = { code: 'Paper C', version: '2026.10-C', title: 'ExamShield Graduate Assessment' }

export const SECTIONS: Array<{ id: SectionId; name: Record<Lang, string>; marks: string }> = [
  { id: 'aptitude', name: { en: 'Aptitude & Reasoning', hi: 'योग्यता एवं तर्क' }, marks: '+2 / 0' },
  { id: 'technical', name: { en: 'Technical & DSA', hi: 'तकनीकी एवं डीएसए' }, marks: '+2 / 0' },
  { id: 'coding', name: { en: 'Coding', hi: 'कोडिंग' }, marks: '+10 per problem' },
]

// Paper structure only (ids, sections, types). The text, options, keys and tests live on the server.
export interface BlueprintItem { id: string; section: SectionId; type: 'mcq' | 'coding' }

export const BLUEPRINT: BlueprintItem[] = [
  { id: 'A1', section: 'aptitude', type: 'mcq' },
  { id: 'A2', section: 'aptitude', type: 'mcq' },
  { id: 'A3', section: 'aptitude', type: 'mcq' },
  { id: 'A4', section: 'aptitude', type: 'mcq' },
  { id: 'A5', section: 'aptitude', type: 'mcq' },
  { id: 'A6', section: 'aptitude', type: 'mcq' },
  { id: 'A7', section: 'aptitude', type: 'mcq' },
  { id: 'A8', section: 'aptitude', type: 'mcq' },
  { id: 'A9', section: 'aptitude', type: 'mcq' },
  { id: 'A10', section: 'aptitude', type: 'mcq' },
  { id: 'A11', section: 'aptitude', type: 'mcq' },
  { id: 'A12', section: 'aptitude', type: 'mcq' },
  { id: 'T1', section: 'technical', type: 'mcq' },
  { id: 'T2', section: 'technical', type: 'mcq' },
  { id: 'T3', section: 'technical', type: 'mcq' },
  { id: 'T4', section: 'technical', type: 'mcq' },
  { id: 'T5', section: 'technical', type: 'mcq' },
  { id: 'T6', section: 'technical', type: 'mcq' },
  { id: 'T7', section: 'technical', type: 'mcq' },
  { id: 'T8', section: 'technical', type: 'mcq' },
  { id: 'T9', section: 'technical', type: 'mcq' },
  { id: 'T10', section: 'technical', type: 'mcq' },
  { id: 'T11', section: 'technical', type: 'mcq' },
  { id: 'T12', section: 'technical', type: 'mcq' },
  { id: 'C1', section: 'coding', type: 'coding' },
  { id: 'C2', section: 'coding', type: 'coding' },
  { id: 'C3', section: 'coding', type: 'coding' },
]

export interface RosterEntry { id: string; name: string; dob: string; path: string; centre: string; lab: string; row: number; col: number }

// dob is the login password (DDMMYYYY), as on most Indian exam portals.
export const ROSTER: RosterEntry[] = [
  { id: 'EXM-20841', name: 'Kavya Sharma', dob: '14082004', path: 'sync-a', centre: 'Pune-02', lab: 'A', row: 1, col: 1 },
  { id: 'EXM-20854', name: 'Rohan Patel', dob: '02112003', path: 'sync-a', centre: 'Pune-02', lab: 'A', row: 1, col: 2 },
  { id: 'EXM-20861', name: 'Aisha Verma', dob: '21052004', path: 'sync-a', centre: 'Pune-02', lab: 'A', row: 1, col: 3 },
  { id: 'EXM-20866', name: 'Sana Khan', dob: '09012004', path: 'sync-a', centre: 'Pune-02', lab: 'A', row: 2, col: 1 },
  { id: 'EXM-20870', name: 'Arjun Nair', dob: '30032003', path: 'sync-a', centre: 'Pune-02', lab: 'A', row: 2, col: 2 },
  { id: 'EXM-20873', name: 'Nikhil Rao', dob: '17072004', path: 'sync-b', centre: 'Mumbai-07', lab: 'B', row: 1, col: 1 },
  { id: 'EXM-20879', name: 'Meera Iyer', dob: '11122003', path: 'sync-b', centre: 'Mumbai-07', lab: 'B', row: 1, col: 2 },
  { id: 'EXM-20882', name: 'Farhan Ali', dob: '25062004', path: 'sync-b', centre: 'Mumbai-07', lab: 'B', row: 2, col: 1 },
  { id: 'EXM-20888', name: 'Priya Das', dob: '04042004', path: 'sync-b', centre: 'Mumbai-07', lab: 'B', row: 2, col: 2 },
  { id: 'EXM-20891', name: 'Karan Mehta', dob: '19092003', path: 'sync-c', centre: 'Delhi-11', lab: 'C', row: 1, col: 1 },
  { id: 'EXM-20895', name: 'Ananya Ghosh', dob: '08022004', path: 'sync-c', centre: 'Delhi-11', lab: 'C', row: 1, col: 2 },
  { id: 'EXM-20899', name: 'Vikram Singh', dob: '27102003', path: 'sync-c', centre: 'Delhi-11', lab: 'C', row: 1, col: 3 },
]

export const rosterEntry = (id?: string) => ROSTER.find((entry) => entry.id === id)

// Neighbours in the same lab (including diagonals) — where copying actually happens in a centre.
export const adjacentSeats = (a?: RosterEntry, b?: RosterEntry) =>
  Boolean(a && b && a.id !== b.id && a.centre === b.centre && a.lab === b.lab && Math.abs(a.row - b.row) <= 1 && Math.abs(a.col - b.col) <= 1)
export const seatLabel = (entry?: RosterEntry) => (entry ? `Lab ${entry.lab} · R${entry.row}S${entry.col}` : '—')
