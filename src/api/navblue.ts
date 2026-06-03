const NAVBLUE_BASE =
  (import.meta.env.VITE_NAVBLUE_BASE_URL as string | undefined)?.replace(/\/$/, '') ||
  'https://vkg.noc.vmc.navblue.cloud/RestAPI/nocrestapi/v1'

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map((v) => parseInt(v, 10))
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ymd
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

function navblueAuthHeader(): Record<string, string> | null {
  const user = (import.meta.env.VITE_NAVBLUE_USER as string | undefined)?.trim()
  const password = (import.meta.env.VITE_NAVBLUE_PASSWORD as string | undefined)?.trim()
  if (!user || !password) return null
  const token = btoa(`${user}:${password}`)
  return { Authorization: `Basic ${token}` }
}

type NavblueFlightplan = {
  Callsign?: string | null
}

type NavblueFlightRow = {
  AirlineCode?: string | null
  FlightNumber?: number | string | null
  Suffix?: string | null
  FlightDate?: string | null
  Flightplan?: NavblueFlightplan | null
}

function navblueLookupKey(flightNumber: string, flightDateYmd: string): string {
  return `${flightNumber.trim().toUpperCase()}|${flightDateYmd}`
}

function flightDateToYmd(v: string | null | undefined): string | null {
  if (!v) return null
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim())
  return m ? m[1] : null
}

export async function fetchNavblueFlightplanCallsignsForDate(ymd: string): Promise<Map<string, string>> {
  const auth = navblueAuthHeader()
  if (!auth) return new Map()

  const to = addDaysYmd(ymd, 1)
  const q = new URLSearchParams({
    From: ymd,
    To: to,
    FlightRequestFilter: 'Flightplan',
  })
  const res = await fetch(`${NAVBLUE_BASE}/flights?${q}`, { headers: auth })
  if (!res.ok) throw new Error(`NAVBLUE HTTP ${res.status}`)

  const rows = (await res.json()) as NavblueFlightRow[]
  const map = new Map<string, string>()
  for (const r of rows) {
    const airlineCode = r.AirlineCode?.trim().toUpperCase() || ''
    const num = String(r.FlightNumber ?? '').trim()
    if (!airlineCode || !num) continue
    const suffix = r.Suffix?.trim().toUpperCase() || ''
    const ymdRow = flightDateToYmd(r.FlightDate)
    const callsign = r.Flightplan?.Callsign?.trim().toUpperCase() || ''
    if (!ymdRow || !callsign) continue
    map.set(navblueLookupKey(`${airlineCode}${num}${suffix}`, ymdRow), callsign)
  }
  return map
}

export function lookupCallsignFromNavblueMap(
  flightNumber: string,
  flightDateYmd: string,
  map: Map<string, string>,
): string | null {
  return map.get(navblueLookupKey(flightNumber, flightDateYmd)) ?? null
}
