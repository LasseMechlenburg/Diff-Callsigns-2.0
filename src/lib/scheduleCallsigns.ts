import {
  buildCallsignLookupMap,
  fetchFlightCallsignsInWindow,
  fetchFlightsInWindow,
  fetchLiveEtaCallsign,
  lookupCallsignFromFlightkeysMap,
  mapPool,
  type OcdcFlightRow,
} from '../api/ocdc.ts'
import {
  fetchNavblueFlightplanCallsignsForDate,
  lookupCallsignFromNavblueMap,
} from '../api/navblue.ts'
import { lookupPdfFallbackCallsign } from '../data/pdfFallbackCallsigns.ts'
import { copenhagenDayUtcRange, stdOnCopenhagenDate, stdToCopenhagenYmd } from './dayBounds.ts'

export type CallsignSource = 'ocdc-search' | 'navblue-flightplan' | 'ocdc-flightkeys' | 'ocdc-live-eta' | 'pdf-fallback'

export type ResolvedCallsign = {
  callsign: string | null
  source: CallsignSource | null
}

/** Samme opløsning som i hovedflowet: søgning → FlightKeys-liste → live-ETA. */
export async function fetchResolvedCallsignsForCopenhagenDay(
  ymd: string,
): Promise<{ dayFlights: OcdcFlightRow[]; signs: ResolvedCallsign[] }> {
  const { dateFrom, dateTo } = copenhagenDayUtcRange(ymd)
  const rows = await fetchFlightsInWindow(dateFrom, dateTo)
  const dayFlights = rows.filter((f) => !f.canceled && stdOnCopenhagenDate(f.STD, ymd))
  let navblueMap = new Map<string, string>()
  try {
    navblueMap = await fetchNavblueFlightplanCallsignsForDate(ymd)
  } catch (error) {
    console.warn('NAVBLUE callsign lookup unavailable, continuing with OCDC/PDF.', error)
  }
  let fkRows: Awaited<ReturnType<typeof fetchFlightCallsignsInWindow>> = []
  try {
    fkRows = await fetchFlightCallsignsInWindow(dateFrom, dateTo)
  } catch (error) {
    // Keep the app usable if FlightKeys summary endpoint is unavailable/forbidden.
    console.warn('FlightKeys callsign summary unavailable, falling back to live-ETA only.', error)
  }
  const fkMap = buildCallsignLookupMap(fkRows)
  const signs = await mapPool(dayFlights, 10, async (f: OcdcFlightRow): Promise<ResolvedCallsign> => {
    const ymdForFlight = stdToCopenhagenYmd(f.STD)
    const fromSearch = f.callsign?.trim()
    if (fromSearch) return { callsign: fromSearch, source: 'ocdc-search' }
    const fromNavblue = lookupCallsignFromNavblueMap(f.flightNumber, ymdForFlight, navblueMap)
    if (fromNavblue) return { callsign: fromNavblue, source: 'navblue-flightplan' }
    const fromFk = lookupCallsignFromFlightkeysMap(f, ymdForFlight, fkMap)
    if (fromFk) return { callsign: fromFk, source: 'ocdc-flightkeys' }
    try {
      const fromLiveEta = await fetchLiveEtaCallsign(f.flightKey)
      if (fromLiveEta) return { callsign: fromLiveEta, source: 'ocdc-live-eta' }
    } catch {
      // Continue to static fallback when live endpoint is unavailable.
    }
    const fromPdf = await lookupPdfFallbackCallsign(f.flightNumber, ymdForFlight)
    if (fromPdf) return { callsign: fromPdf, source: 'pdf-fallback' }
    return { callsign: null, source: null }
  })
  return { dayFlights, signs }
}
