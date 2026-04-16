export type CharterKind = 'sca' | 'wetlease' | 'posi'

const POSI_MIN = 4901
const POSI_MAX = 4989

/** SCA: DK901–DK969 (ekstra fly, kun tre cifre). */
export function isScaFlightNumberN(n: number): boolean {
  return n >= 901 && n <= 969
}

/** Wetlease: DK970–DK999 (ekstra fly, kun tre cifre). */
export function isWetleaseFlightNumberN(n: number): boolean {
  return n >= 970 && n <= 999
}

export function dkFlightNumber(n: number): string {
  return `DK${n}`
}

export function inferVkgCallsignFromFlightNumber(flightNumber: string): string | null {
  const m = /^DK(\d{3,})$/i.exec(flightNumber.trim())
  if (!m) return null
  return `VKG${m[1]}`
}

function tripletAllSame(d: string): boolean {
  return d.length === 3 && d[0] === d[1] && d[1] === d[2]
}

function allDigitsIdentical(s: string): boolean {
  return s.length > 0 && [...s].every((c) => c === s[0])
}

function hammingEqualLen(a: string, b: string): number {
  let d = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++
  return d
}

function isVkgSuffixLowBandBlocked(tri: string): boolean {
  if (!/^\d{3}$/.test(tri)) return true
  const n = parseInt(tri, 10)
  return n >= 1 && n <= 100
}

export function parseVkgDigitSuffix(callsign: string): string | null {
  const m = /^VKG(\d{3,})$/i.exec(callsign.trim())
  return m ? m[1] : null
}

export function clashSuffixesFromSchedule(
  flights: { flightNumber: string }[],
  liveCallsigns: (string | null)[],
): string[] {
  const out: string[] = []
  for (let i = 0; i < flights.length; i++) {
    const raw = liveCallsigns[i]?.trim() || ''
    const cs = raw || inferVkgCallsignFromFlightNumber(flights[i].flightNumber)
    const suf = cs ? parseVkgDigitSuffix(cs) : null
    if (suf) out.push(suf)
  }
  return out
}

/**
 * Trafik-clash mellem to ciffer-suffixe fra callsigns.
 * Tre cifre: kun eksakt match (Hamming<2 blokerede hele 9xx mod hinanden; endsWith blokerede fx
 * 901 mod POSI-suffix 4901). Fire+ cifre: Hamming<2. Forskellig længde: ingen clash.
 */
function digitSuffixesClash(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  if (a.length === 3) return false
  return hammingEqualLen(a, b) < 2
}

function isDigitSuffixAllowed(candidate: string, existingSuffixes: string[]): boolean {
  if (!/^\d{3,}$/.test(candidate)) return false
  if (candidate.length === 3) {
    if (isVkgSuffixLowBandBlocked(candidate)) return false
    if (tripletAllSame(candidate)) return false
  } else if (allDigitsIdentical(candidate)) {
    return false
  }
  for (const ex of existingSuffixes) {
    if (digitSuffixesClash(candidate, ex)) return false
  }
  return true
}

function mirrorCallsignForN(n: number): string {
  return `VKG${n}`
}

function isSuffixExactExcluded(suf: string, excludeExact: string[]): boolean {
  return excludeExact.some((e) => e === suf)
}

/**
 * Spejl (VKG + samme tal som efter DK) først mod dagens eksisterende data.
 * `excludeExact`: ciffer-suffixe der allerede er brugt i denne kørsel (så de to forslag ikke får identisk callsign).
 * Ingen Hamming-/clash-test mellem de to ben — kun mod `clashSuffixes` og mod duplikat.
 */
function pickCallsignForLeg(
  n: number,
  dkFn: string,
  clashSuffixes: string[],
  excludeExactSuffixes: string[],
): string | null {
  const mirrorSuf = String(n)
  if (
    !isSuffixExactExcluded(mirrorSuf, excludeExactSuffixes) &&
    isDigitSuffixAllowed(mirrorSuf, clashSuffixes)
  ) {
    return mirrorCallsignForN(n)
  }
  for (const tri of digitDerivedTriplets(dkFn)) {
    if (isSuffixExactExcluded(tri, excludeExactSuffixes)) continue
    if (isDigitSuffixAllowed(tri, clashSuffixes)) return `VKG${tri}`
  }
  const inferred = inferVkgCallsignFromFlightNumber(dkFn)
  if (inferred) {
    const suf = parseVkgDigitSuffix(inferred)
    if (
      suf &&
      !isSuffixExactExcluded(suf, excludeExactSuffixes) &&
      isDigitSuffixAllowed(suf, clashSuffixes)
    )
      return inferred
  }
  for (const tri of suffixCandidates) {
    if (isSuffixExactExcluded(tri, excludeExactSuffixes)) continue
    if (isDigitSuffixAllowed(tri, clashSuffixes)) return `VKG${tri}`
  }
  return null
}

export function digitDerivedTriplets(dkFlight: string): string[] {
  const m = /^DK(\d{3,4})$/i.exec(dkFlight.trim())
  if (!m) return []
  const digits = m[1]
  const seen = new Set<string>()
  const out: string[] = []
  const push = (s: string) => {
    if (s.length !== 3 || seen.has(s)) return
    seen.add(s)
    out.push(s)
  }
  if (digits.length === 3) {
    push(digits)
    return out
  }
  const d = digits.split('')
  push(d[1] + d[2] + d[3])
  push(d[0] + d[1] + d[2])
  push(d[0] + d[1] + d[3])
  push(d[0] + d[2] + d[3])
  push(d[0] + d[2] + d[1])
  push(d[1] + d[0] + d[2])
  push(d[1] + d[2] + d[0])
  push(d[2] + d[0] + d[1])
  push(d[2] + d[1] + d[0])
  return out
}

function orderedSuffixCandidates(): string[] {
  const out: string[] = []
  for (let n = 0; n <= 999; n++) {
    const s = String(n).padStart(3, '0')
    if (tripletAllSame(s)) continue
    if (isVkgSuffixLowBandBlocked(s)) continue
    out.push(s)
  }
  return out
}

const suffixCandidates = orderedSuffixCandidates()

export function pickVkgCallsignForFlight(
  dkFlightNumber: string,
  existingSuffixes: string[],
): string | null {
  for (const tri of digitDerivedTriplets(dkFlightNumber)) {
    if (isDigitSuffixAllowed(tri, existingSuffixes)) return `VKG${tri}`
  }
  const inferred = inferVkgCallsignFromFlightNumber(dkFlightNumber)
  if (inferred) {
    const suf = parseVkgDigitSuffix(inferred)
    if (suf && isDigitSuffixAllowed(suf, existingSuffixes)) return inferred
  }
  for (const tri of suffixCandidates) {
    if (isDigitSuffixAllowed(tri, existingSuffixes)) return `VKG${tri}`
  }
  return null
}

function posiCallsignQualityRank(dkFlightNumber: string, clashSuffixes: string[]): number {
  const m = /^DK(\d+)$/i.exec(dkFlightNumber.trim())
  if (m) {
    const num = parseInt(m[1], 10)
    if (!Number.isNaN(num) && isDigitSuffixAllowed(String(num), clashSuffixes)) return 0
  }
  for (const tri of digitDerivedTriplets(dkFlightNumber)) {
    if (isDigitSuffixAllowed(tri, clashSuffixes)) return 1
  }
  const inferred = inferVkgCallsignFromFlightNumber(dkFlightNumber)
  if (inferred) {
    const suf = parseVkgDigitSuffix(inferred)
    if (suf && isDigitSuffixAllowed(suf, clashSuffixes)) return 2
  }
  for (const tri of suffixCandidates) {
    if (isDigitSuffixAllowed(tri, clashSuffixes)) return 3
  }
  return 99
}

export type Suggestion = { flightNumber: string; callsign: string }

/** Start på ud/retur-par: start og start+1 ligger begge i charter-interval (kun DK9xx). */
function charterPairStartsOrdered(kind: 'sca' | 'wetlease'): number[] {
  const ok = kind === 'sca' ? isScaFlightNumberN : isWetleaseFlightNumberN
  const out: number[] = []
  const lo = kind === 'sca' ? 901 : 970
  const hi = kind === 'sca' ? 968 : 998
  for (let s = lo; s <= hi; s++) {
    if (ok(s) && ok(s + 1)) out.push(s)
  }
  return out
}

function buildCharterRoundTripPair(
  kind: 'sca' | 'wetlease',
  usedFlightNumbers: Set<string>,
  clashSuffixes: string[],
): Suggestion[] {
  for (const start of charterPairStartsOrdered(kind)) {
    const suggestions: Suggestion[] = []
    const excludeExact: string[] = []
    let ok = true
    for (let k = 0; k < 2; k++) {
      const n = start + k
      const fn = dkFlightNumber(n)
      if (usedFlightNumbers.has(fn.toUpperCase())) {
        ok = false
        break
      }
      const cs = pickCallsignForLeg(n, fn, clashSuffixes, excludeExact)
      if (!cs) {
        ok = false
        break
      }
      const suf = parseVkgDigitSuffix(cs)
      if (!suf) {
        ok = false
        break
      }
      suggestions.push({ flightNumber: fn, callsign: cs })
      excludeExact.push(suf)
    }
    if (ok && suggestions.length === 2) return suggestions
  }
  return []
}

function buildPosiPair(usedFlightNumbers: Set<string>, clashSuffixes: string[]): Suggestion[] {
  const free: number[] = []
  for (let n = POSI_MIN; n <= POSI_MAX; n++) {
    if (!usedFlightNumbers.has(dkFlightNumber(n).toUpperCase())) free.push(n)
  }
  free.sort((a, b) => {
    const ra = posiCallsignQualityRank(dkFlightNumber(a), clashSuffixes)
    const rb = posiCallsignQualityRank(dkFlightNumber(b), clashSuffixes)
    if (ra !== rb) return ra - rb
    return a - b
  })

  const suggestions: Suggestion[] = []
  const excludeExact: string[] = []
  for (const n of free) {
    if (suggestions.length >= 2) break
    const fn = dkFlightNumber(n)
    const cs = pickCallsignForLeg(n, fn, clashSuffixes, excludeExact)
    if (!cs) continue
    const suf = parseVkgDigitSuffix(cs)
    if (!suf) continue
    suggestions.push({ flightNumber: fn, callsign: cs })
    excludeExact.push(suf)
  }
  return suggestions
}

export function buildTwoSuggestions(
  kind: CharterKind,
  usedFlightNumbers: Set<string>,
  clashSuffixes: string[],
): Suggestion[] {
  if (kind === 'posi') return buildPosiPair(usedFlightNumbers, clashSuffixes)
  return buildCharterRoundTripPair(kind, usedFlightNumbers, clashSuffixes)
}
