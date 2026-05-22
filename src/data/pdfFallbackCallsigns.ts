import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import callsignsPdfUrl from '../../Reference/Callsigns.pdf?url'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const byDateFlightNumber = new Map<string, string>()
let loadPromise: Promise<void> | null = null

function toYmd(ddMmYyyy: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(ddMmYyyy.trim())
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

function buildKey(flightDateYmd: string, flightNumber: string): string {
  return `${flightDateYmd}|${flightNumber.trim().toUpperCase()}`
}

async function loadPdfFallbackMap(): Promise<void> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    const bytes = await fetch(callsignsPdfUrl).then((r) => r.arrayBuffer())
    const doc = await getDocument({ data: bytes }).promise
    const rowRegex =
      /\b\d+\s+DK\s+(\d+)\s+\S+\s+\S+\s+(\d{2}-\d{2}-\d{4})\s+\d{4}\s+\d{4}\s+(VKG\d+)\b/gi

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber)
      const text = await page.getTextContent()
      const normalized = text.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
      rowRegex.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = rowRegex.exec(normalized)) !== null) {
        const flightNumber = `DK${match[1]}`
        const ymd = toYmd(match[2])
        const callsign = match[3].toUpperCase()
        if (!ymd) continue
        byDateFlightNumber.set(buildKey(ymd, flightNumber), callsign)
      }
    }
  })()
  return loadPromise
}

export async function lookupPdfFallbackCallsign(
  flightNumber: string,
  flightDateYmd: string,
): Promise<string | null> {
  try {
    await loadPdfFallbackMap()
  } catch (error) {
    console.warn('Unable to read PDF fallback callsign data.', error)
    return null
  }
  return byDateFlightNumber.get(buildKey(flightDateYmd, flightNumber)) ?? null
}
