import { cents, formatDollarRange, type Cents, type CentsRange } from "./money";

/** The target a Goal may have, inclusive, as a whole number of dollars. */
export const GOAL_TARGET_RANGE: CentsRange = { min: cents(1_00), max: cents(10_000_000_00) };

/** A Goal target out of range, or on an account that isn't one of the customer's savings accounts. */
export class GoalError extends Error {
  override name = "GoalError";
}

/** Returns `target` if it is a whole-dollar amount inside GOAL_TARGET_RANGE, or throws GoalError. */
export function checkGoalTarget(target: Cents): Cents {
  if (target % 100 !== 0 || target < GOAL_TARGET_RANGE.min || target > GOAL_TARGET_RANGE.max) {
    throw new GoalError(`A target must be a whole-dollar amount from ${formatDollarRange(GOAL_TARGET_RANGE)}`);
  }
  return target;
}
