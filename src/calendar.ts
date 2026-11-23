declare const localDateBrand: unique symbol;

/** A calendar date in the bank's time zone, written YYYY-MM-DD, such as a payday. */
export type LocalDate = string & { readonly [localDateBrand]: true };

/** The time zone the bank keeps its calendar in: paydays, due dates and "today". */
export const BANK_TIME_ZONE = "America/New_York";

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Returns `text` as a LocalDate, or throws if it isn't a real YYYY-MM-DD date. */
export function localDate(text: string): LocalDate {
  const match = ISO_DATE.exec(text);
  if (!match || new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text) {
    throw new RangeError(`Not a calendar date: ${text}`);
  }
  return text as LocalDate;
}

const dateParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: BANK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The bank's calendar date at `instant`. */
export function localDateOf(instant: Date): LocalDate {
  const parts = Object.fromEntries(dateParts.formatToParts(instant).map((part) => [part.type, part.value]));
  return localDate(`${parts.year}-${parts.month}-${parts.day}`);
}

function utcMidnight(date: LocalDate): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return localDate(new Date(utcMidnight(date) + days * DAY_MS).toISOString().slice(0, 10));
}

/** Whole days from `from` to `to`, negative when `to` is earlier. */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((utcMidnight(to) - utcMidnight(from)) / DAY_MS);
}
