// Client-safe car-year helpers — no server imports here.
//
// A season runs June 1 to May 31, and is named after the car it builds:
// June 2026 – May 2027 is AME27.

const FIRST_CAR_YEAR = 24;

/** The car a date's season builds, e.g. 2026-11-07 → "AME27". Uses UTC, like the DB. */
export function carYearForDate(date: Date): string {
    const yy = date.getUTCFullYear() % 100;
    return `AME${date.getUTCMonth() >= 5 ? yy + 1 : yy}`;
}

export const CURRENT_CAR_YEAR = carYearForDate(new Date());

/** AME24 through the current season's car; grows by one each June. */
export const CAR_YEARS: string[] = Array.from(
    { length: Number(CURRENT_CAR_YEAR.slice(3)) - FIRST_CAR_YEAR + 1 },
    (_, i) => `AME${FIRST_CAR_YEAR + i}`,
);

export function isCarYear(value: unknown): value is string {
    return typeof value === 'string' && CAR_YEARS.includes(value);
}

/** Season bounds for a car year: AME27 → 2026-06-01 to 2027-05-31 (UTC). */
export function seasonRange(carYear: string): { start: Date; end: Date } {
    const year = 2000 + Number(carYear.slice(3));
    return {
        start: new Date(Date.UTC(year - 1, 5, 1)),
        end: new Date(Date.UTC(year, 4, 31, 23, 59, 59)),
    };
}
