/** I dev bruges Vite-proxy til `/api`. I build kan du sætte `VITE_API_ROOT=http://host:3002/api/v1` hvis CORS tillader det. */
const API_BASE = (import.meta.env.VITE_API_ROOT as string | undefined)?.replace(/\/$/, '') || '/api/v1'

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  const rawBearer = (import.meta.env.VITE_API_BEARER_TOKEN as string | undefined)?.trim()
  const apiKey = (import.meta.env.VITE_API_KEY as string | undefined)?.trim()
  if (rawBearer) {
    headers.Authorization = /^Bearer\s+/i.test(rawBearer) ? rawBearer : `Bearer ${rawBearer}`
  }
  if (apiKey) headers['X-API-Key'] = apiKey
  return headers
}

function authFetchInit(): RequestInit | undefined {
  const headers = authHeaders()
  return Object.keys(headers).length > 0 ? { headers } : undefined
}

export type OcdcFlightRow = {
  flightKey: string
  flightNumber: string
  /** Ofte sat for udførte fly; typisk null for langt frem «Scheduled» — så live-ETA / antaget. */
  callsign?: string | null
  departureICAO?: string | null
  arrivalICAO?: string | null
  STD: string
  canceled?: boolean
}

/** Række fra `GET /api/v1/flights/callsigns` (FlightKeys summary). */
export type OcdcCallsignMappingRow = {
  flightNumber: string | null
  flightDate: string | null
  departureICAO: string | null
  arrivalICAO: string | null
  callsign: string | null
}

type FlightsSearchPayload = {
  success: boolean
  data: {
    flights: OcdcFlightRow[]
    pagination: { total: number; take: number; skip: number; hasMore: boolean }
  }
}

type LiveEtaPayload = {
  success: boolean
  data: { flightKey: string; callsign: string | null }
}

type FlightCallsignsPayload = {
  success: boolean
  data: {
    rows: OcdcCallsignMappingRow[]
    pagination: { total: number; take: number; skip: number; hasMore: boolean }
  }
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`)
  }
  return res.json() as Promise<T>
}

export async function fetchFlightsInWindow(
  dateFrom: string,
  dateTo: string,
  pageSize = 200,
): Promise<OcdcFlightRow[]> {
  const all: OcdcFlightRow[] = []
  let skip = 0
  let hasMore = true
  while (hasMore) {
    const q = new URLSearchParams({
      dateFrom,
      dateTo,
      take: String(pageSize),
      skip: String(skip),
    })
    const res = await fetch(`${API_BASE}/flights/search?${q}`, authFetchInit())
    const body = await readJson<FlightsSearchPayload>(res)
    if (!body.success) throw new Error('flights/search success=false')
    const chunk = body.data.flights
    all.push(...chunk)
    hasMore = body.data.pagination.hasMore
    skip += chunk.length
    if (chunk.length === 0) break
  }
  return all
}

/** FlightKeys flightnummer ↔ callsign for et tidsvindue (pagineret). */
export async function fetchFlightCallsignsInWindow(
  dateFrom: string,
  dateTo: string,
  pageSize = 200,
): Promise<OcdcCallsignMappingRow[]> {
  const all: OcdcCallsignMappingRow[] = []
  let skip = 0
  let hasMore = true
  while (hasMore) {
    const q = new URLSearchParams({
      dateFrom,
      dateTo,
      take: String(pageSize),
      skip: String(skip),
    })
    const res = await fetch(`${API_BASE}/flights/callsigns?${q}`, authFetchInit())
    const body = await readJson<FlightCallsignsPayload>(res)
    if (!body.success) throw new Error('flights/callsigns success=false')
    const chunk = body.data.rows
    all.push(...chunk)
    hasMore = body.data.pagination.hasMore
    skip += chunk.length
    if (chunk.length === 0) break
  }
  return all
}

export function callsignMappingLookupKey(
  flightNumber: string,
  flightDateYmd: string,
  depIcao: string,
  arrIcao: string,
): string {
  return `${flightNumber.trim().toUpperCase()}|${flightDateYmd}|${depIcao.trim().toUpperCase()}|${arrIcao.trim().toUpperCase()}`
}

export function buildCallsignLookupMap(rows: OcdcCallsignMappingRow[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const r of rows) {
    const cs = r.callsign?.trim()
    const fn = r.flightNumber?.trim()
    const fd = r.flightDate?.trim()
    if (!cs || !fn || !fd) continue
    const dep = r.departureICAO ?? ''
    const arr = r.arrivalICAO ?? ''
    map.set(callsignMappingLookupKey(fn, fd, dep, arr), cs)
  }
  return map
}

export function lookupCallsignFromFlightkeysMap(
  f: OcdcFlightRow,
  flightDateYmd: string,
  map: Map<string, string>,
): string | null {
  const fn = f.flightNumber
  const dep = f.departureICAO ?? ''
  const arr = f.arrivalICAO ?? ''
  const k = callsignMappingLookupKey(fn, flightDateYmd, dep, arr)
  return map.get(k) ?? null
}

export async function fetchLiveEtaCallsign(flightKey: string): Promise<string | null> {
  const enc = encodeURIComponent(flightKey)
  const res = await fetch(`${API_BASE}/flights/${enc}/flightkeys/live-eta`, authFetchInit())
  if (res.status === 404) return null
  const body = await readJson<LiveEtaPayload>(res)
  if (!body.success) return null
  return body.data.callsign
}

export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  }

  const n = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: n }, () => worker()))
  return results
}
