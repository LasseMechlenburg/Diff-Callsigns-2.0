import {
  buildCallsignLookupMap,
  fetchFlightCallsignsInWindow,
  fetchFlightsInWindow,
  fetchLiveEtaCallsign,
  lookupCallsignFromFlightkeysMap,
  mapPool,
  type OcdcFlightRow,
} from '../api/ocdc.ts'
import { copenhagenDayUtcRange, stdOnCopenhagenDate, stdToCopenhagenYmd } from './dayBounds.ts'

/** Samme opløsning som i hovedflowet: søgning → FlightKeys-liste → live-ETA. */
export async function fetchResolvedCallsignsForCopenhagenDay(
  ymd: string,
): Promise<{ dayFlights: OcdcFlightRow[]; signs: (string | null)[] }> {
  const { dateFrom, dateTo } = copenhagenDayUtcRange(ymd)
  const rows = await fetchFlightsInWindow(dateFrom, dateTo)
  const dayFlights = rows.filter((f) => !f.canceled && stdOnCopenhagenDate(f.STD, ymd))
  const fkRows = await fetchFlightCallsignsInWindow(dateFrom, dateTo)
  const fkMap = buildCallsignLookupMap(fkRows)
  const signs = await mapPool(dayFlights, 10, async (f: OcdcFlightRow) => {
    const fromSearch = f.callsign?.trim()
    if (fromSearch) return fromSearch
    const fromFk = lookupCallsignFromFlightkeysMap(f, stdToCopenhagenYmd(f.STD), fkMap)
    if (fromFk) return fromFk
    try {
      return await fetchLiveEtaCallsign(f.flightKey)
    } catch {
      return null
    }
  })
  return { dayFlights, signs }
}
