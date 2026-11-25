import { cents, formatDollars } from "./money";
import type { MemberBalance } from "./split-page";

/** Where the customer stands with another Member: "Alex Okafor owes you $133.04", "You owe …" or "Settled up". */
export function memberBalanceText(member: MemberBalance): string {
  switch (member.status) {
    case "owes_you":
      return `${member.name} owes you ${formatDollars(member.net)}`;
    case "you_owe":
      return `You owe ${member.name} ${formatDollars(cents(-member.net))}`;
    case "settled_up":
      return `${member.name}: Settled up`;
  }
}
