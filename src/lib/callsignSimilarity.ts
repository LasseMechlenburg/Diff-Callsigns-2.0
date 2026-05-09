function hammingEqualLen(a: string, b: string): number {
  let d = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++
  return d
}

function tripletAllSame(d: string): boolean {
  return d.length === 3 && d[0] === d[1] && d[1] === d[2]
}

function isLowBandThreeDigit(tri: string): boolean {
  if (!/^\d{3}$/.test(tri)) return true
  const n = parseInt(tri, 10)
  return n >= 1 && n <= 100
}

/**
 * «Radiomæssigt for tæt»: fx VKG441 vs VKG4441 (suffix indeholder/afslutter på det andet),
 * eller næsten identiske suffixe (maks 1 ciffer forskelligt).
 */
export function suffixesRiskySimilarForRadio(a: string, b: string): boolean {
  if (!a || !b || !/^\d+$/.test(a) || !/^\d+$/.test(b)) return false
  if (a === b) return true
  const la = a.length
  const lb = b.length
  if (la !== lb) {
    if (la < 3 || lb < 3) return false
    const short = la < lb ? a : b
    const long = la < lb ? b : a
    if (short.length < 3) return false
    return long.endsWith(short)
  }
  if (la >= 3) return hammingEqualLen(a, b) <= 1
  return hammingEqualLen(a, b) === 0
}

function suffixVariantsForCompare(full: string): string[] {
  const out = new Set<string>([full])
  if (full.length >= 3) out.add(full.slice(-3))
  return [...out]
}

export function suffixesRiskyVsAnyExisting(candidate3: string, existingSuffixes: string[]): boolean {
  if (!/^\d{3}$/.test(candidate3)) return true
  for (const ex of existingSuffixes) {
    for (const part of suffixVariantsForCompare(ex)) {
      if (suffixesRiskySimilarForRadio(candidate3, part)) return true
    }
  }
  return false
}

export type CallsignScheduleEntry = {
  flightNumber: string
  callsign: string
  suffix: string
  registration?: string | null
  windowStartMs?: number | null
  windowEndMs?: number | null
}

export type RiskyCallsignPair = {
  flightNumberA: string
  callsignA: string
  suffixA: string
  flightNumberB: string
  callsignB: string
  suffixB: string
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

function normalizedRegistration(reg: string | null | undefined): string | null {
  if (!reg) return null
  const v = reg.trim().toUpperCase()
  if (!v) return null
  return v.replace(/[^A-Z0-9]/g, '')
}

function isSameRegistration(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizedRegistration(a)
  const nb = normalizedRegistration(b)
  if (!na || !nb) return false
  return na === nb
}

function hasKnownWindow(e: CallsignScheduleEntry): e is CallsignScheduleEntry & {
  windowStartMs: number
  windowEndMs: number
} {
  return Number.isFinite(e.windowStartMs) && Number.isFinite(e.windowEndMs)
}

function windowsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart <= bEnd && bStart <= aEnd
}

export function findRiskyCallsignPairs(entries: CallsignScheduleEntry[]): RiskyCallsignPair[] {
  const out: RiskyCallsignPair[] = []
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]!
      const b = entries[j]!
      // Consecutive flight numbers are planned on separate timings, so skip them.
      if (areConsecutiveFlightNumbers(a.flightNumber, b.flightNumber)) continue
      // Flights on the same aircraft registration are not airborne simultaneously.
      if (isSameRegistration(a.registration, b.registration)) continue
      // If we know both flight windows and they do not overlap, skip.
      if (
        hasKnownWindow(a) &&
        hasKnownWindow(b) &&
        !windowsOverlap(a.windowStartMs, a.windowEndMs, b.windowStartMs, b.windowEndMs)
      )
        continue
      if (suffixesRiskySimilarForRadio(a.suffix, b.suffix)) {
        out.push({
          flightNumberA: a.flightNumber,
          callsignA: a.callsign,
          suffixA: a.suffix,
          flightNumberB: b.flightNumber,
          callsignB: b.callsign,
          suffixB: b.suffix,
        })
      }
    }
  }
  return out
}

/** Tre-cifrede VKG-tal der ikke er radiomæssigt for tæt på nogen eksisterende suffix på dagen. */
export function suggestSafeThreeDigitVkgSuffixes(
  existingSuffixes: string[],
  maxSuggestions: number,
): string[] {
  const out: string[] = []
  for (let n = 0; n <= 999 && out.length < maxSuggestions; n++) {
    const s = String(n).padStart(3, '0')
    if (tripletAllSame(s)) continue
    if (isLowBandThreeDigit(s)) continue
    if (suffixesRiskyVsAnyExisting(s, existingSuffixes)) continue
    out.push(s)
  }
  return out
}
