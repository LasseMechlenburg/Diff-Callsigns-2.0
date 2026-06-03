import './style.css'
import { addDaysToCopenhagenYmd } from './lib/dayBounds.ts'
import {
  type CharterKind,
  buildTwoSuggestions,
  inferVkgCallsignFromFlightNumber,
  parseVkgDigitSuffix,
} from './lib/allocate.ts'
import {
  findRiskyCallsignPairs,
  suggestSafeThreeDigitVkgSuffixes,
  type CallsignScheduleEntry,
} from './lib/callsignSimilarity.ts'
import { fetchResolvedCallsignsForCopenhagenDay, type ResolvedCallsign } from './lib/scheduleCallsigns.ts'
import type { OcdcFlightRow } from './api/ocdc.ts'

const RAIDO_NOTE =
  'Hvis callsign er forskelligt fra Flynummer, så skal callsign indsættes i Leg under Flightplan Tab i Item 7 i Raido, efter flight er opdrettet i Raido.'

const STATUS_LOADING = 'Henter data for valgte dag'
const STATUS_TOMORROW = 'Henter morgendagens data…'

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Partial<HTMLElementTagNameMap[K]> & { class?: string; text?: string },
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (props) {
    const { class: cls, text, ...rest } = props
    if (cls) node.className = cls
    if (text !== undefined) node.textContent = text
    Object.assign(node, rest)
  }
  for (const c of children) node.append(typeof c === 'string' ? document.createTextNode(c) : c)
  return node
}

const KINDS: { id: CharterKind; label: string; hint: string }[] = [
  {
    id: 'sca',
    label: 'SCA extra charter',
    hint: 'DK901–969 · spejl VKG=tal når muligt',
  },
  {
    id: 'wetlease',
    label: 'Wetlease extra charter',
    hint: 'DK970–999 · spejl VKG=tal når muligt',
  },
  {
    id: 'posi',
    label: 'POSI flight number',
    hint: 'DK4901–DK4989 → VKG',
  },
]

const root = document.querySelector<HTMLDivElement>('#app')!
let selected: CharterKind = 'sca'

const dateInput = el('input', {
  class: 'date',
  type: 'date',
  value: todayYmd(),
}) as HTMLInputElement

const kindRow = el('div', { class: 'kind-row' })
const statusEl = el('p', { class: 'status', text: '' })
const resultEl = el('div', { class: 'result' })
const tomorrowResultEl = el('div', { class: 'tomorrow-result' })
const runBtn = el('button', { class: 'primary', type: 'button', text: 'Foreslå 2 muligheder' })
const checkTomorrowBtn = el('button', {
  type: 'button',
  class: 'check-tomorrow',
  text: 'Check Morgendagen for clashing callsigns',
})

function renderKindButtons(): void {
  kindRow.replaceChildren()
  for (const k of KINDS) {
    const b = el(
      'button',
      {
        type: 'button',
        class: `kind ${selected === k.id ? 'active' : ''}`,
        title: k.hint,
      },
      [k.label],
    )
    b.addEventListener('click', () => {
      selected = k.id
      renderKindButtons()
    })
    kindRow.append(b)
  }
}

function raidoNoteEl(): HTMLParagraphElement {
  return el('p', { class: 'raidonote', text: RAIDO_NOTE })
}

function callsignMirrorsFlightNumber(flightNumber: string, callsign: string): boolean {
  const inferred = inferVkgCallsignFromFlightNumber(flightNumber)
  if (!inferred) return false
  return inferred.trim().toUpperCase() === callsign.trim().toUpperCase()
}

function resolveRegistration(f: OcdcFlightRow): string | null {
  const row = f as OcdcFlightRow & {
    registration?: string | null
    aircraftRegistration?: string | null
    aircraftReg?: string | null
  }
  const reg = row.registration ?? row.aircraftRegistration ?? row.aircraftReg ?? null
  const v = reg?.trim()
  return v ? v.toUpperCase() : null
}

function toEpochMs(v: string | null | undefined): number | null {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

function resolveFlightWindow(f: OcdcFlightRow): { startMs: number; endMs: number } | null {
  const row = f as OcdcFlightRow & {
    ETD?: string | null
    ATD?: string | null
    departureTime?: string | null
    departureTimeUtc?: string | null
    STA?: string | null
    ETA?: string | null
    ATA?: string | null
    arrivalTime?: string | null
    arrivalTimeUtc?: string | null
  }
  const startMs =
    toEpochMs(row.ATD) ??
    toEpochMs(row.ETD) ??
    toEpochMs(row.departureTimeUtc) ??
    toEpochMs(row.departureTime) ??
    toEpochMs(f.STD)
  const endMs =
    toEpochMs(row.ATA) ??
    toEpochMs(row.ETA) ??
    toEpochMs(row.STA) ??
    toEpochMs(row.arrivalTimeUtc) ??
    toEpochMs(row.arrivalTime)
  if (startMs === null || endMs === null) return null
  if (endMs < startMs) return { startMs: endMs, endMs: startMs }
  return { startMs, endMs }
}

function parseCarrierAndNumericFlightNumber(flightNumber: string): { carrier: string; num: number } | null {
  const m = /^([A-Z]{2})(\d{3,5})$/i.exec(flightNumber.trim())
  if (!m) return null
  const num = parseInt(m[2], 10)
  if (!Number.isFinite(num)) return null
  return { carrier: m[1].toUpperCase(), num }
}

function areConsecutiveFlightNumbers(a: string, b: string): boolean {
  const pa = parseCarrierAndNumericFlightNumber(a)
  const pb = parseCarrierAndNumericFlightNumber(b)
  if (!pa || !pb) return false
  if (pa.carrier !== pb.carrier) return false
  return Math.abs(pa.num - pb.num) === 1
}

function normalizeRegistration(reg: string | null | undefined): string | null {
  if (!reg) return null
  const cleaned = reg.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  return cleaned || null
}

function windowsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd
}

function canBeSimultaneous(a: CallsignScheduleEntry, b: CallsignScheduleEntry): boolean {
  if (areConsecutiveFlightNumbers(a.flightNumber, b.flightNumber)) return false
  const regA = normalizeRegistration(a.registration)
  const regB = normalizeRegistration(b.registration)
  if (regA && regB && regA === regB) return false
  if (
    Number.isFinite(a.windowStartMs) &&
    Number.isFinite(a.windowEndMs) &&
    Number.isFinite(b.windowStartMs) &&
    Number.isFinite(b.windowEndMs)
  ) {
    return windowsOverlap(
      a.windowStartMs as number,
      a.windowEndMs as number,
      b.windowStartMs as number,
      b.windowEndMs as number,
    )
  }
  return true
}

function buildCallsignEntries(dayFlights: OcdcFlightRow[], signs: ResolvedCallsign[]): CallsignScheduleEntry[] {
  const entries: CallsignScheduleEntry[] = []
  for (let i = 0; i < dayFlights.length; i++) {
    const f = dayFlights[i]!
    const raw = signs[i]?.callsign?.trim() || ''
    const cs = raw
    if (!cs) continue
    const suf = parseVkgDigitSuffix(cs)
    if (!suf) continue
    const window = resolveFlightWindow(f)
    entries.push({
      flightNumber: f.flightNumber.trim().toUpperCase(),
      callsign: cs.trim().toUpperCase(),
      suffix: suf,
      registration: resolveRegistration(f),
      windowStartMs: window?.startMs ?? null,
      windowEndMs: window?.endMs ?? null,
    })
  }
  return entries
}

function relevantConcurrentSuffixes(entries: CallsignScheduleEntry[]): string[] {
  if (entries.length <= 1) return entries.map((e) => e.suffix)
  const kept = new Set<string>()
  for (let i = 0; i < entries.length; i++) {
    const a = entries[i]!
    if (!Number.isFinite(a.windowStartMs) || !Number.isFinite(a.windowEndMs)) {
      kept.add(a.suffix)
      continue
    }
    for (let j = 0; j < entries.length; j++) {
      if (i === j) continue
      const b = entries[j]!
      if (canBeSimultaneous(a, b)) {
        kept.add(a.suffix)
        break
      }
    }
  }
  return [...kept]
}

function buildDataTable(
  dayFlights: OcdcFlightRow[],
  resolvedCallsigns: ResolvedCallsign[],
): HTMLDetailsElement {
  const rows = dayFlights
    .map((f, i) => {
      const fn = f.flightNumber.trim().toUpperCase()
      const row = resolvedCallsigns[i]
      const liveRaw = row?.callsign?.trim() || ''
      const isPdfFallback = row?.source === 'pdf-fallback'
      let display: string
      if (liveRaw) {
        display = isPdfFallback
          ? `${liveRaw} (Fallback CHECK THIS CALLSIGN MANUALLY)`
          : liveRaw
      }
      else display = '—'
      return { fn, display }
    })
    .sort((a, b) => a.fn.localeCompare(b.fn, 'da'))

  const tbody = el('tbody')
  for (const r of rows) {
    tbody.append(
      el('tr', {}, [
        el('td', {}, [r.fn]),
        el('td', { class: 'mono' }, [r.display || '—']),
      ]),
    )
  }

  const table = el('table', { class: 'data-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Flynummer (IATA)' }),
        el('th', { text: 'Callsign' }),
      ]),
    ]),
    tbody,
  ])

  const det = el('details', { class: 'data-block' }) as HTMLDetailsElement
  const sum = el('summary', { text: `Grunddata: ${rows.length} fly med STD på valgte dag (sorteret på flynummer)` })
  const cap = el('p', {
    class: 'table-cap',
    text: 'Callsign: flyoversigt (søgning) → FlightKeys-liste (`/flights/callsigns`) → live-ETA → PDF-fallback. Hvis ingen kilde har callsign, vises den som tom (—).',
  })
  det.append(sum, cap, table)
  return det
}

async function run(): Promise<void> {
  const ymd = dateInput.value
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    statusEl.textContent = 'Vælg en gyldig dato.'
    resultEl.replaceChildren()
    return
  }

  runBtn.disabled = true
  checkTomorrowBtn.disabled = true
  statusEl.textContent = STATUS_LOADING
  resultEl.replaceChildren()
  tomorrowResultEl.replaceChildren()

  try {
    const { dayFlights, signs } = await fetchResolvedCallsignsForCopenhagenDay(ymd)
    const entries = buildCallsignEntries(dayFlights, signs)

    const usedNumbers = new Set(dayFlights.map((f) => f.flightNumber.trim().toUpperCase()))

    const clashSuffixes = relevantConcurrentSuffixes(entries)
    const suggestions = buildTwoSuggestions(selected, usedNumbers, clashSuffixes)

    const dataBlock = buildDataTable(dayFlights, signs)

    if (suggestions.length === 0) {
      const err =
        selected === 'posi'
          ? 'Ingen to komplette forslag (POSI-interval eller callsign-clash).'
          : 'Intet ledigt ud/retur-par i charter-interval med to gyldige callsigns (eller clash med eksisterende data).'
      resultEl.replaceChildren(dataBlock, el('p', { class: 'error', text: err }))
    } else {
      const ol = el('ol', { class: 'suggestions' })
      for (const s of suggestions) {
        const mirror = callsignMirrorsFlightNumber(s.flightNumber, s.callsign)
        const csEl = el('strong', { text: s.callsign })
        if (!mirror) csEl.className = 'callsign-mismatch'
        ol.append(el('li', {}, [el('strong', { text: s.flightNumber }), ' · ', csEl]))
      }
      const needsRaidoNote = suggestions.some(
        (s) => !callsignMirrorsFlightNumber(s.flightNumber, s.callsign),
      )

      resultEl.replaceChildren(
        dataBlock,
        el('h2', { class: 'subh', text: 'Forslag (op til to)' }),
        ol,
        ...(needsRaidoNote ? [raidoNoteEl()] : []),
      )
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    resultEl.replaceChildren(el('p', { class: 'error', text: msg }))
  } finally {
    runBtn.disabled = false
    checkTomorrowBtn.disabled = false
    if (statusEl.textContent === STATUS_LOADING) statusEl.textContent = ''
  }
}

async function checkTomorrowCallsignSimilarity(): Promise<void> {
  const ymd = dateInput.value
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    statusEl.textContent = 'Vælg en gyldig dato.'
    tomorrowResultEl.replaceChildren()
    return
  }

  const tomorrowYmd = addDaysToCopenhagenYmd(ymd, 1)
  checkTomorrowBtn.disabled = true
  runBtn.disabled = true
  statusEl.textContent = STATUS_TOMORROW
  tomorrowResultEl.replaceChildren()

  try {
    const { dayFlights, signs } = await fetchResolvedCallsignsForCopenhagenDay(tomorrowYmd)
    const entries = buildCallsignEntries(dayFlights, signs)

    const pairs = findRiskyCallsignPairs(entries)
    const allSuffixes = relevantConcurrentSuffixes(entries)
    const safeTriples = suggestSafeThreeDigitVkgSuffixes(allSuffixes, 12)

    if (pairs.length === 0) {
      tomorrowResultEl.append(
        el('h2', { class: 'subh', text: `Morgendag ${tomorrowYmd}` }),
        el('p', {
          class: 'tomorrow-ok',
          text: 'Ingen callsign-par fundet der er radiomæssigt for tæt på hinanden (samme suffix, suffix som ender på andet suffix, eller kun ét ciffer forskelligt).',
        }),
      )
    } else {
      const ul = el('ul', { class: 'tomorrow-pairs' })
      for (const p of pairs) {
        ul.append(
          el('li', {}, [
            el('strong', { text: p.flightNumberA }),
            ' ',
            el('span', { class: 'mono', text: p.callsignA }),
            ' ↔ ',
            el('strong', { text: p.flightNumberB }),
            ' ',
            el('span', { class: 'mono', text: p.callsignB }),
            ` (suffix ${p.suffixA} / ${p.suffixB})`,
          ]),
        )
      }
      const chips = el('div', { class: 'suggest-chips' })
      for (const t of safeTriples) {
        chips.append(el('span', { class: 'chip', text: `VKG${t}` }))
      }
      tomorrowResultEl.append(
        el('h2', { class: 'subh', text: `Morgendag ${tomorrowYmd} — ${pairs.length} mulige forvekslinger` }),
        el('p', {
          class: 'table-cap',
          text: 'Par der kan forveksles i radio: samme suffix, suffix som del af længere nummer (fx 441 i 4441), eller kun ét ciffer forskelligt på samme længde. Fortløbende flynumre, samme registrering og ikke-overlappende tidsvinduer filtreres fra.',
        }),
        ul,
        el('h3', { class: 'subh-sm', text: 'Forslag: 3-cifrede VKG der ikke ligger for tæt på morgendagens suffixe' }),
        chips,
      )
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    tomorrowResultEl.append(el('p', { class: 'error', text: msg }))
  } finally {
    checkTomorrowBtn.disabled = false
    runBtn.disabled = false
    if (statusEl.textContent === STATUS_TOMORROW) statusEl.textContent = ''
  }
}

runBtn.addEventListener('click', () => void run())
checkTomorrowBtn.addEventListener('click', () => void checkTomorrowCallsignSimilarity())

const dateRow = el('div', { class: 'date-row' }, [
  el('label', { class: 'field date-field' }, ['Dato for flyvning', dateInput]),
  checkTomorrowBtn,
])

root.append(
  el('header', { class: 'header' }, [el('h1', { text: 'Ekstra charter / POSI — flynummer og VKG' })]),
  el('section', { class: 'panel' }, [
    dateRow,
    el('div', { class: 'field' }, [el('span', { class: 'lbl', text: 'Type' }), kindRow]),
    runBtn,
    statusEl,
    resultEl,
    tomorrowResultEl,
  ]),
)

renderKindButtons()
