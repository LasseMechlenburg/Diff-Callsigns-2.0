import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

const TZ = 'Europe/Copenhagen'

/** `ymd` = YYYY-MM-DD interpreted in Europe/Copenhagen. */
export function copenhagenDayUtcRange(ymd: string): { dateFrom: string; dateTo: string } {
  const start = dayjs.tz(ymd, TZ).startOf('day').utc().subtract(12, 'hour')
  const end = dayjs.tz(ymd, TZ).endOf('day').utc().add(12, 'hour')
  return { dateFrom: start.toISOString(), dateTo: end.toISOString() }
}

export function stdOnCopenhagenDate(stdIso: string, ymd: string): boolean {
  return dayjs(stdIso).tz(TZ).format('YYYY-MM-DD') === ymd
}

/** Kalenderdato for STD i København (YYYY-MM-DD), fx til match mod FlightKeys `flightDate`. */
export function stdToCopenhagenYmd(stdIso: string): string {
  return dayjs(stdIso).tz(TZ).format('YYYY-MM-DD')
}

/** Læg dage til en kalenderdato i København (YYYY-MM-DD). */
export function addDaysToCopenhagenYmd(ymd: string, deltaDays: number): string {
  return dayjs.tz(ymd, TZ).add(deltaDays, 'day').format('YYYY-MM-DD')
}
