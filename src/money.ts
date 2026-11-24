declare const centsBrand: unique symbol;

/** An amount of imaginary money in whole cents. Never a floating-point dollar value. */
export type Cents = number & { readonly [centsBrand]: true };

/** Returns `amount` as Cents, or throws if it is not a safe whole number of cents. */
export function cents(amount: number): Cents {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`Money must be a whole number of cents, got ${amount}`);
  }
  return amount as Cents;
}

/** Formats cents as US dollars, such as `$1,234.56` or `-$0.05`, using integer arithmetic only. */
export function formatDollars(amount: Cents): string {
  const sign = amount < 0 ? "-" : "";
  const absolute = Math.abs(amount);
  const remainder = absolute % 100;
  const dollars = (absolute - remainder) / 100;
  const grouped = dollars.toLocaleString("en-US");
  return `${sign}$${grouped}.${String(remainder).padStart(2, "0")}`;
}

const DOLLAR_TEXT = /^\$?(\d*)(?:\.(\d{1,2}))?$/;

/**
 * Reads a dollar amount someone typed, such as `12`, `12.5` or `$1,234.05`, as Cents without
 * floating-point arithmetic. Throws RangeError for anything else, including negative amounts.
 */
export function parseDollars(text: string): Cents {
  const match = DOLLAR_TEXT.exec(text.trim().replaceAll(",", ""));
  const [, dollars = "", fraction = ""] = match ?? [];
  if (!match || (dollars === "" && fraction === "")) {
    throw new RangeError(`Not a dollar amount: ${JSON.stringify(text)}`);
  }
  return cents(Number(dollars || "0") * 100 + Number(fraction.padEnd(2, "0")));
}

/** An inclusive range of amounts. */
export interface CentsRange {
  min: Cents;
  max: Cents;
}

/** Formats an amount as plain text for a form input that `parseDollars` reads back, such as `1500` or `1839.50`. */
export function formatDollarsForInput(amount: Cents): string {
  const sign = amount < 0 ? "-" : "";
  const absolute = Math.abs(amount);
  const remainder = absolute % 100;
  const dollars = String((absolute - remainder) / 100);
  return remainder === 0 ? `${sign}${dollars}` : `${sign}${dollars}.${String(remainder).padStart(2, "0")}`;
}

/** Formats a range briefly, such as `$0 to $10,000`. */
export function formatDollarRange(range: CentsRange): string {
  return `${formatDollarsBriefly(range.min)} to ${formatDollarsBriefly(range.max)}`;
}

/** Formats cents as US dollars, leaving off zero cents, such as `$340` or `$12.50`. */
export function formatDollarsBriefly(amount: Cents): string {
  return amount % 100 === 0 ? formatDollars(amount).slice(0, -3) : formatDollars(amount);
}
