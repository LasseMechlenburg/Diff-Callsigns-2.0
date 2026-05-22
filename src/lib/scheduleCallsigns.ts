import {
  buildCallsignLookupMap,
  fetchFlightCallsignsInWindow,
  fetchFlightsInWindow,
  fetchLiveEtaCallsign,
  lookupCallsignFromFlightkeysMap,
  mapPool,
  type OcdcFlightRow,
} from '../api/ocdc.ts'
import { lookupPdfFallbackCallsign } from '../data/pdfFallbackCallsigns.ts'
import { copenhagenDayUtcRange, stdOnCopenhagenDate, stdToCopenhagenYmd } from './dayBounds.ts'

/** Samme opløsning som i hovedflowet: søgning → FlightKeys-liste → live-ETA. */
export async function fetchResolvedCallsignsForCopenhagenDay(
  ymd: string,
): Promise<{ dayFlights: OcdcFlightRow[]; signs: (string | null)[] }> {
  const { dateFrom, dateTo } = copenhagenDayUtcRange(ymd)
  const rows = await fetchFlightsInWindow(dateFrom, dateTo)
  const dayFlights = rows.filter((f) => !f.canceled && stdOnCopenhagenDate(f.STD, ymd))
  let fkRows: Awaited<ReturnType<typeof fetchFlightCallsignsInWindow>> = []
  try {
    fkRows = await fetchFlightCallsignsInWindow(dateFrom, dateTo)
  } catch (error) {
    // Keep the app usable if FlightKeys summary endpoint is unavailable/forbidden.
    console.warn('FlightKeys callsign summary unavailable, falling back to live-ETA only.', error)
  }
  const fkMap = buildCallsignLookupMap(fkRows)
  const signs = await mapPool(dayFlights, 10, async (f: OcdcFlightRow) => {
    const ymdForFlight = stdToCopenhagenYmd(f.STD)
    const fromSearch = f.callsign?.trim()
    if (fromSearch) return fromSearch
    const fromFk = lookupCallsignFromFlightkeysMap(f, ymdForFlight, fkMap)
    if (fromFk) return fromFk
    try {
      const fromLiveEta = await fetchLiveEtaCallsign(f.flightKey)
      if (fromLiveEta) return fromLiveEta
    } catch {
      // Continue to static fallback when live endpoint is unavailable.
    }
    return await lookupPdfFallbackCallsign(f.flightNumber, ymdForFlight)
  })
  return { dayFlights, signs }
}
