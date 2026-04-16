import './style.css'
import { copenhagenDayUtcRange, stdOnCopenhagenDate, stdToCopenhagenYmd } from './lib/dayBounds.ts'
import {
  type CharterKind,
  buildTwoSuggestions,
  clashSuffixesFromSchedule,
  inferVkgCallsignFromFlightNumber,
} from './lib/allocate.ts'
import {
  buildCallsignLookupMap,
  fetchFlightCallsignsInWindow,
  fetchFlightsInWindow,
  fetchLiveEtaCallsign,
  lookupCallsignFromFlightkeysMap,
  mapPool,
  type OcdcFlightRow,
} from './api/ocdc.ts'

const RAIDO_NOTE =
  'Hvis callsign er forskelligt fra Flynummer, så skal callsign indsættes i Leg under Flightplan Tab i Item 7 i Raido, efter flight er opdrettet i Raido.'

const STATUS_LOADING = 'Henter data for valgte dag'

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
const runBtn = el('button', { class: 'primary', type: 'button', text: 'Foreslå 2 muligheder' })

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

function buildDataTable(
  dayFlights: OcdcFlightRow[],
  rawCallsigns: (string | null)[],
): HTMLDetailsElement {
  const rows = dayFlights
    .map((f, i) => {
      const fn = f.flightNumber.trim().toUpperCase()
      const liveRaw = rawCallsigns[i]?.trim() || ''
      const inferred = inferVkgCallsignFromFlightNumber(f.flightNumber)
      let display: string
      if (liveRaw) display = liveRaw
      else if (inferred) display = `${inferred} (antaget)`
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
    text: 'Callsign: flyoversigt (søgning) → FlightKeys-liste (`/flights/callsigns`) → live-ETA. «Antaget» kun hvis ingen af delene; VKG + samme cifre som efter DK (fx DK628→VKG628). Clash bruger hele cifferstrengen efter VKG.',
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
  statusEl.textContent = STATUS_LOADING
  resultEl.replaceChildren()

  try {
    const { dateFrom, dateTo } = copenhagenDayUtcRange(ymd)
    const rows = await fetchFlightsInWindow(dateFrom, dateTo)
    const dayFlights = rows.filter((f) => !f.canceled && stdOnCopenhagenDate(f.STD, ymd))

    const usedNumbers = new Set(dayFlights.map((f) => f.flightNumber.trim().toUpperCase()))

    const fkRows = await fetchFlightCallsignsInWindow(dateFrom, dateTo)
    const fkCallsignMap = buildCallsignLookupMap(fkRows)

    const signs = await mapPool(dayFlights, 10, async (f: OcdcFlightRow) => {
      const fromSearch = f.callsign?.trim()
      if (fromSearch) return fromSearch
      const fromFk = lookupCallsignFromFlightkeysMap(f, stdToCopenhagenYmd(f.STD), fkCallsignMap)
      if (fromFk) return fromFk
      try {
        return await fetchLiveEtaCallsign(f.flightKey)
      } catch {
        return null
      }
    })

    const clashSuffixes = clashSuffixesFromSchedule(dayFlights, signs)
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
    if (statusEl.textContent === STATUS_LOADING) statusEl.textContent = ''
  }
}

runBtn.addEventListener('click', () => void run())

root.append(
  el('header', { class: 'header' }, [el('h1', { text: 'Ekstra charter / POSI — flynummer og VKG' })]),
  el('section', { class: 'panel' }, [
    el('label', { class: 'field' }, ['Dato for flyvning', dateInput]),
    el('div', { class: 'field' }, [el('span', { class: 'lbl', text: 'Type' }), kindRow]),
    runBtn,
    statusEl,
    resultEl,
  ]),
)

renderKindButtons()
