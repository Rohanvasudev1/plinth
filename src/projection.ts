// No database or server imports here: the Forecast page's slider runs `projectionLines` in the browser.
import type { Category } from "./categories";
import { cents, divideCents, type Cents } from "./money";

/** How many months the Projection runs for: three years. */
export const PROJECTION_MONTHS = 36;

/** The largest cut the slider tries, as a whole percent. */
export const MAX_CUT_PERCENT = 50;

/** What the Projection starts from: the sweep target's balance today and the Left to save at each pace. */
export interface Projection {
  kind: "projection";
  /** The sweep target's Goal account name, such as "House fund". */
  goalAccountName: string;
  /** The sweep target's balance today. */
  balance: Cents;
  /** Left to save in the Usual month and On pace, the monthly saving of the first two lines. Below zero when spending is higher. */
  leftToSave: { usualMonth: Cents; onPace: Cents };
  /** The Categories the slider tries cutting: Eating out and Shopping. */
  cutCategories: readonly Category[];
  /** Their On pace spending, which the slider's cut comes off. */
  cuttable: Cents;
}

/** One pace's line: its monthly saving and the balance at the end of each of the next 36 months. */
export interface ProjectionLine {
  monthlySaving: Cents;
  balances: Cents[];
}

export interface ProjectionLines {
  usualMonth: ProjectionLine;
  onPace: ProjectionLine;
  /** This month's pace with On pace spending in the cut Categories cut by the slider's percent. */
  withChanges: ProjectionLine;
}

/**
 * The Projection's three lines with Eating out and Shopping cut by `cutPercent`, a whole number from 0 to 50. Each
 * adds its monthly saving to the balance once a month for 36 months, with no interest. A negative saving lowers the
 * balance, which never goes below zero. Throws RangeError for any other cut.
 */
export function projectionLines(projection: Projection, cutPercent: number): ProjectionLines {
  if (!Number.isInteger(cutPercent) || cutPercent < 0 || cutPercent > MAX_CUT_PERCENT) {
    throw new RangeError(`The cut must be a whole percent from 0 to ${MAX_CUT_PERCENT}, got ${cutPercent}`);
  }
  const { leftToSave } = projection;
  const withChangesSaving = cents(leftToSave.onPace + divideCents(projection.cuttable * cutPercent, 100));
  const line = (monthlySaving: Cents): ProjectionLine => ({
    monthlySaving,
    balances: balancesFrom(projection.balance, monthlySaving),
  });
  return {
    usualMonth: line(leftToSave.usualMonth),
    onPace: line(leftToSave.onPace),
    withChanges: line(withChangesSaving),
  };
}

function balancesFrom(start: Cents, monthlySaving: Cents): Cents[] {
  const balances: Cents[] = [];
  let balance: number = start;
  for (let month = 0; month < PROJECTION_MONTHS; month++) {
    balance = Math.max(0, balance + monthlySaving);
    balances.push(cents(balance));
  }
  return balances;
}
