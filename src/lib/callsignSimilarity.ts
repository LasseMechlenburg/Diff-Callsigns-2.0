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
 * eller tre-cifrede der kun adskiller sig lidt (fx 441 vs 413 — Hamming ≤ 2).
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
    return long.endsWith(short) || short.endsWith(long)
  }
  if (la >= 3) return hammingEqualLen(a, b) <= 2
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
}

export type RiskyCallsignPair = {
  flightNumberA: string
  callsignA: string
  suffixA: string
  flightNumberB: string
  callsignB: string
  suffixB: string
}

export function findRiskyCallsignPairs(entries: CallsignScheduleEntry[]): RiskyCallsignPair[] {
  const out: RiskyCallsignPair[] = []
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]!
      const b = entries[j]!
      let hit = false
      for (const va of suffixVariantsForCompare(a.suffix)) {
        for (const vb of suffixVariantsForCompare(b.suffix)) {
          if (suffixesRiskySimilarForRadio(va, vb)) {
            hit = true
            break
          }
        }
        if (hit) break
      }
      if (hit) {
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
