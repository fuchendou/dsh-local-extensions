const OFFSET = 8 * 60 * 60_000
const DAY = 24 * 60 * 60_000

export function beijingDate(ms: number): Date {
  return new Date(ms + OFFSET)
}

export function parseBeijingTime(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return undefined
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number]
  if (year < 100 || hour > 23 || minute > 59) return undefined
  const utc = Date.UTC(year, month - 1, day, hour, minute)
  const check = new Date(utc)
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return undefined
  return utc - OFFSET
}

export function tomorrowNine(now: number): number {
  const date = beijingDate(now)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 9) - OFFSET
}

export function sameBeijingDay(a: number, b: number): boolean {
  const left = beijingDate(a)
  const right = beijingDate(b)
  return left.getUTCFullYear() === right.getUTCFullYear() && left.getUTCMonth() === right.getUTCMonth() && left.getUTCDate() === right.getUTCDate()
}

export function tomorrow(now: number): number {
  return now + DAY
}
