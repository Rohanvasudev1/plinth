import type { LocalDate } from "./calendar";
import type { Customer, CustomerData } from "./customer-data";
import { cents, type Cents } from "./money";
import {
  balanceStatus,
  netBetween,
  NotAMemberError,
  shareOf,
  stillCounts,
  type BalanceStatus,
  type Group,
  type GroupId,
  type MemberId,
  type OutsideContactId,
} from "./split";

/** Another Member of one of the customer's Groups, with where the customer stands with them. */
export interface MemberBalance {
  memberId: MemberId;
  name: string;
  /** Above zero, they owe the customer; below zero, the customer owes them. */
  net: Cents;
  status: BalanceStatus;
}

/** One Shared cost as the customer sees it: who paid and the customer's own Share. */
export interface SharedCostOnPage {
  id: number;
  date: LocalDate;
  description: string;
  amount: Cents;
  paidByName: string;
  paidByYou: boolean;
  yourShare: Cents;
}

export interface GroupOnPage {
  id: GroupId;
  name: string;
  /** Every Member's name, the customer included, in the order they joined. */
  memberNames: string[];
  /** Every Member but the customer, each with their net with the customer only. */
  otherMembers: MemberBalance[];
  /** Shared costs that still count, newest first. */
  sharedCosts: SharedCostOnPage[];
}

export interface SplitSummary {
  /** The sum of what every other Member who owes the customer owes them. */
  owedToYou: Cents;
  /** The sum of what the customer owes every Member they owe. */
  youOwe: Cents;
  /** Owed to you less you owe. */
  net: Cents;
}

/** The Split page: the customer's Groups and their own figures, never a net between two other Members. */
export interface SplitView {
  groups: GroupOnPage[];
  summary: SplitSummary;
}

/** One of the customer's Groups as their Split page shows it. */
export function groupOnPage(customer: Customer, group: Group): GroupOnPage {
  const you = group.members.find((member) => member.customerId === customer.id);
  if (!you) throw new NotAMemberError("You aren't a Member of that Group");
  const nameOf = (memberId: MemberId) => group.members.find((member) => member.id === memberId)?.name ?? "Someone";
  return {
    id: group.id,
    name: group.name,
    memberNames: group.members.map((member) => member.name),
    otherMembers: group.members
      .filter((member) => member.id !== you.id)
      .map((member) => {
        const net = netBetween(group, you.id, member.id);
        return { memberId: member.id, name: member.name, net, status: balanceStatus(net) };
      }),
    sharedCosts: group.sharedCosts
      .filter(stillCounts)
      .map((cost) => ({
        id: cost.id,
        date: cost.date,
        description: cost.description,
        amount: cost.amount,
        paidByName: nameOf(cost.paidBy),
        paidByYou: cost.paidBy === you.id,
        yourShare: shareOf(cost, group.members.length, you.id),
      })),
  };
}

/** The customer's Split page. Their own page view, so it writes no access log entry (ADR 0011). */
export function readSplitView(customerData: CustomerData, customer: Customer): SplitView {
  const groups = customerData.listGroups(customer).map((group) => groupOnPage(customer, group));
  const nets = groups.flatMap((group) => group.otherMembers.map((member) => member.net));
  const owedToYou = nets.filter((net) => net > 0).reduce((sum, net) => sum + net, 0);
  const youOwe = nets.filter((net) => net < 0).reduce((sum, net) => sum - net, 0);
  return { groups, summary: { owedToYou: cents(owedToYou), youOwe: cents(youOwe), net: cents(owedToYou - youOwe) } };
}

/** An Outside contact in one of the customer's Groups, for the Simulator's form that plays them. */
export interface OutsideContactInGroup {
  /** Names this Outside contact in this Group, for a form to send back. */
  key: string;
  outsideContactId: OutsideContactId;
  name: string;
  groupId: GroupId;
  groupName: string;
}

/** Each Outside contact in each of the customer's Groups, so the Simulator names no Group the customer isn't in. */
export function outsideContactsInGroups(customerData: CustomerData, customer: Customer): OutsideContactInGroup[] {
  return customerData.listGroups(customer).flatMap((group) =>
    group.members.flatMap((member) =>
      member.outsideContactId === null
        ? []
        : [
            {
              key: `${member.outsideContactId}:${group.id}`,
              outsideContactId: member.outsideContactId,
              name: member.name,
              groupId: group.id,
              groupName: group.name,
            },
          ],
    ),
  );
}
