import { cents, type Cents } from "./money";

/** The buffer Rule: keep `buffer` in the checking account after bills before payday, and sweep the rest to savings. */
export interface BufferRuleParameters {
  checkingAccountId: number;
  savingsAccountId: number;
  buffer: Cents;
}

export type RuleKind = "buffer";

/** One version of a Rule (ADR 0003). Editing a Rule, including switching it on or off, writes a new version. */
export interface Rule {
  id: number;
  kind: RuleKind;
  version: number;
  on: boolean;
  parameters: BufferRuleParameters;
  createdAt: Date;
}

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
export function bufferRuleFor(rules: Rule[], checkingAccountId: number): Rule | undefined {
  const matching = rules.filter((rule) => rule.kind === "buffer" && rule.parameters.checkingAccountId === checkingAccountId);
  return matching.find((rule) => rule.on) ?? matching.at(-1);
}

export function isRuleKind(kind: string): kind is RuleKind {
  return kind === "buffer";
}

/** Checks `parameters` against the schema for `kind`, and returns them typed, or throws RuleParametersError. */
export function parseRuleParameters(kind: RuleKind, parameters: unknown): BufferRuleParameters {
  if (kind !== "buffer") throw new RuleParametersError(`Unknown Rule kind ${String(kind)}`);
  if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
    throw new RuleParametersError("A buffer Rule's parameters must be an object");
  }
  const expected = ["checkingAccountId", "savingsAccountId", "buffer"];
  const keys = Object.keys(parameters);
  const unexpected = keys.filter((key) => !expected.includes(key));
  if (unexpected.length > 0) throw new RuleParametersError(`Unexpected buffer Rule parameters: ${unexpected.join(", ")}`);
  const { checkingAccountId, savingsAccountId, buffer } = parameters as Record<string, unknown>;
  if (!isId(checkingAccountId)) throw new RuleParametersError("checkingAccountId must be an account id");
  if (!isId(savingsAccountId)) throw new RuleParametersError("savingsAccountId must be an account id");
  if (typeof buffer !== "number" || !Number.isSafeInteger(buffer) || buffer < 0) {
    throw new RuleParametersError("buffer must be a whole number of cents, zero or more");
  }
  return { checkingAccountId, savingsAccountId, buffer: cents(buffer) };
}

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
