import { cents, type Cents } from "./money";

/** The buffer Rule: keep `buffer` in the checking account after bills before payday, and sweep the rest to savings. */
export interface BufferRuleParameters {
  checkingAccountId: number;
  savingsAccountId: number;
  buffer: Cents;
}

/** The payment limit Rule: the largest amount the agent may move alone under "handle small things". */
export interface PaymentLimitRuleParameters {
  paymentLimit: Cents;
}

/**
 * The amounts a customer may set, inclusive, each a whole number of dollars. The payment limit schema enforces
 * its range. The buffer schema takes any amount of cents from zero, and the range applies when the customer
 * sets the Buffer.
 */
export const BUFFER_RANGE = { min: cents(0), max: cents(100_000_00) } as const;
export const PAYMENT_LIMIT_RANGE = { min: cents(0), max: cents(10_000_00) } as const;

export const RULE_KINDS = ["buffer", "payment_limit"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

/** A Rule's kind with its typed parameters. */
export type RuleContent =
  | { kind: "buffer"; parameters: BufferRuleParameters }
  | { kind: "payment_limit"; parameters: PaymentLimitRuleParameters };

/** One version of a Rule (ADR 0003). Editing a Rule, including switching it on or off, writes a new version. */
export type Rule = RuleContent & {
  id: number;
  version: number;
  on: boolean;
  createdAt: Date;
};

export type BufferRule = Extract<Rule, { kind: "buffer" }>;
export type PaymentLimitRule = Extract<Rule, { kind: "payment_limit" }>;

export interface NewRule {
  kind: RuleKind;
  /** Checked against the kind's schema. */
  parameters: unknown;
  on: boolean;
}

/** A Rule's parameters don't match its kind's schema. */
export class RuleParametersError extends Error {
  override name = "RuleParametersError";
}

/**
 * The buffer Rule that keeps a Buffer in this checking account: a switched-on one if there is one, else the
 * latest switched-off one, since switching the agent off doesn't change the Buffer the customer chose.
 */
export function bufferRuleFor(rules: Rule[], checkingAccountId: number): BufferRule | undefined {
  const matching = rules.filter(
    (rule): rule is BufferRule => rule.kind === "buffer" && rule.parameters.checkingAccountId === checkingAccountId,
  );
  return matching.find((rule) => rule.on) ?? matching.at(-1);
}

export function isRuleKind(kind: string): kind is RuleKind {
  return (RULE_KINDS as readonly string[]).includes(kind);
}

/** Checks `parameters` against the schema for `kind`, and returns them typed, or throws RuleParametersError. */
export function parseRuleContent(kind: RuleKind, parameters: unknown): RuleContent {
  switch (kind) {
    case "buffer": {
      const { checkingAccountId, savingsAccountId, buffer } = fieldsOf("buffer", parameters, [
        "checkingAccountId",
        "savingsAccountId",
        "buffer",
      ]);
      if (!isId(checkingAccountId)) throw new RuleParametersError("checkingAccountId must be an account id");
      if (!isId(savingsAccountId)) throw new RuleParametersError("savingsAccountId must be an account id");
      if (typeof buffer !== "number" || !Number.isSafeInteger(buffer) || buffer < 0) {
        throw new RuleParametersError("buffer must be a whole number of cents, zero or more");
      }
      return { kind, parameters: { checkingAccountId, savingsAccountId, buffer: cents(buffer) } };
    }
    case "payment_limit": {
      const { paymentLimit } = fieldsOf("payment limit", parameters, ["paymentLimit"]);
      return { kind, parameters: { paymentLimit: checkWholeDollars(paymentLimit, PAYMENT_LIMIT_RANGE) } };
    }
    default:
      throw new RuleParametersError(`Unknown Rule kind ${String(kind satisfies never)}`);
  }
}

function fieldsOf(name: string, parameters: unknown, expected: string[]): Record<string, unknown> {
  if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
    throw new RuleParametersError(`A ${name} Rule's parameters must be an object`);
  }
  const keys = Object.keys(parameters);
  const unexpected = keys.filter((key) => !expected.includes(key));
  if (unexpected.length > 0) throw new RuleParametersError(`Unexpected ${name} Rule parameters: ${unexpected.join(", ")}`);
  const missing = expected.filter((key) => !keys.includes(key));
  if (missing.length > 0) throw new RuleParametersError(`Missing ${name} Rule parameters: ${missing.join(", ")}`);
  return parameters as Record<string, unknown>;
}

/** Returns `value` as Cents if it is a whole number of dollars inside `range`, or throws RuleParametersError. */
export function checkWholeDollars(value: unknown, range: { min: Cents; max: Cents }): Cents {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value % 100 !== 0 ||
    value < range.min ||
    value > range.max
  ) {
    throw new RuleParametersError(`Must be a whole number of dollars from ${range.min} to ${range.max} cents`);
  }
  return cents(value);
}

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
