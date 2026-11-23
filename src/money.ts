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
  const dollars = Math.trunc(absolute / 100);
  const remainder = absolute % 100;
  const grouped = dollars.toLocaleString("en-US");
  return `${sign}$${grouped}.${String(remainder).padStart(2, "0")}`;
}
