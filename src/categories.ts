/** Every Category a ledger transaction can have. */
export const CATEGORIES = [
  "Housing",
  "Utilities",
  "Groceries",
  "Eating out",
  "Shopping",
  "Transport",
  "Subscriptions",
  "Entertainment",
  "Health",
  "Income",
  "Savings",
] as const;

/** The kind of spending, income or saving a ledger transaction is, such as Groceries or Housing. */
export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}
