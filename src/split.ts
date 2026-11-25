// No database imports here: the schema reads SHARED_COST_SOURCES.
import type { LocalDate } from "./calendar";
import { cents, type Cents } from "./money";

declare const groupIdBrand: unique symbol;
declare const memberIdBrand: unique symbol;
declare const outsideContactIdBrand: unique symbol;

/** A Group's id. */
export type GroupId = number & { readonly [groupIdBrand]: true };
/** One Member's id within their Group, kept apart from customer ids so the two can't be swapped. */
export type MemberId = number & { readonly [memberIdBrand]: true };
/** An Outside contact's id, kept apart from customer ids. */
export type OutsideContactId = number & { readonly [outsideContactIdBrand]: true };

function positiveId(id: number, what: string): number {
  if (!Number.isSafeInteger(id) || id <= 0) throw new RangeError(`Not a ${what} id: ${id}`);
  return id;
}

/** Returns `id` as a GroupId, or throws RangeError if it isn't a positive whole number. */
export function asGroupId(id: number): GroupId {
  return positiveId(id, "Group") as GroupId;
}

export function asMemberId(id: number): MemberId {
  return positiveId(id, "Member") as MemberId;
}

export function asOutsideContactId(id: number): OutsideContactId {
  return positiveId(id, "Outside contact") as OutsideContactId;
}

/** A person outside Plinth whom the Simulator plays as a Member, such as Jordan Reyes. */
export interface OutsideContact {
  id: OutsideContactId;
  name: string;
}

/** Who a Member is, by id: a Plinth customer or an Outside contact. */
export type MemberIdentity = { customerId: number } | { outsideContactId: OutsideContactId };

/** One person in a Group: a Plinth customer or an Outside contact, each named by id. */
export interface Member {
  id: MemberId;
  name: string;
  /** Null for an Outside contact. */
  customerId: number | null;
  /** Null for a customer. */
  outsideContactId: OutsideContactId | null;
}

/** How a Shared cost was added: by hand, from Activity, from a Finding, or by the Split rule. */
export const SHARED_COST_SOURCES = ["by_hand", "activity", "finding", "split_rule"] as const;
export type SharedCostSource = (typeof SHARED_COST_SOURCES)[number];

/** An amount one Member paid for their Group, split into equal Shares. */
export interface SharedCost {
  id: number;
  groupId: GroupId;
  /** The Member who paid. */
  paidBy: MemberId;
  /** What it was for. */
  description: string;
  amount: Cents;
  date: LocalDate;
  source: SharedCostSource;
  /** The Split rule's Decision log entry, on a Shared cost the Split rule added. */
  decisionId: number | null;
  /** The payer's ledger transaction it came from, if any. A ledger transaction is the source of at most one. */
  ledgerTransactionId: number | null;
  /** When it was removed, such as by an Undo. A removed Shared cost doesn't count. */
  removedAt: Date | null;
}

/** A fixed set of Members who share costs, with its Shared costs newest first. */
export interface Group {
  id: GroupId;
  name: string;
  members: Member[];
  sharedCosts: SharedCost[];
}

/** A new Shared cost, paid by the Member adding it. */
export interface NewSharedCost {
  groupId: GroupId;
  description: string;
  amount: Cents;
  date: LocalDate;
  source: SharedCostSource;
  ledgerTransactionId?: number;
}

/** A Group read or write refused: the reader isn't a Member, or the Shared cost doesn't fit. */
export class SplitError extends Error {
  override name = "SplitError";
}

/** The reader isn't a Member of the Group they named. Pages answer 404, as if the Group weren't there. */
export class NotAMemberError extends SplitError {
  override name = "NotAMemberError";
}

/**
 * The Shares of an amount split equally among `memberCount` Members: each other Member's Share is the amount divided
 * by the count, rounded down to the cent, and the payer's Share is the rest, leftover cents included.
 */
export function sharesOf(amount: Cents, memberCount: number): { payer: Cents; other: Cents } {
  if (!Number.isSafeInteger(memberCount) || memberCount < 1) throw new RangeError(`A Group can't have ${memberCount} Members`);
  const other = Math.floor(amount / memberCount);
  return { payer: cents(amount - other * (memberCount - 1)), other: cents(other) };
}

/** The Share of `cost` that `member` owes, out of a Group of `memberCount` Members. */
export function shareOf(cost: SharedCost, memberCount: number, member: MemberId): Cents {
  const shares = sharesOf(cost.amount, memberCount);
  return cost.paidBy === member ? shares.payer : shares.other;
}

/**
 * The net between Members `a` and `b` in a Group: b's Shares of costs a paid, minus a's Shares of costs b paid.
 * Above zero, b owes a. Removed Shared costs don't count. Every page and module works the net out here.
 */
export function netBetween(group: Group, a: MemberId, b: MemberId): Cents {
  const count = group.members.length;
  let net = 0;
  for (const cost of group.sharedCosts) {
    if (cost.removedAt !== null) continue;
    if (cost.paidBy === a) net += shareOf(cost, count, b);
    if (cost.paidBy === b) net -= shareOf(cost, count, a);
  }
  return cents(net);
}

/** Where a customer stands with one other Member: they owe the customer, the customer owes them, or neither. */
export type BalanceStatus = "owes_you" | "you_owe" | "settled_up";

/** The status of a net worked out by `netBetween(group, you, them)`. Pages show this, never re-deriving it. */
export function balanceStatus(net: Cents): BalanceStatus {
  if (net > 0) return "owes_you";
  if (net < 0) return "you_owe";
  return "settled_up";
}
