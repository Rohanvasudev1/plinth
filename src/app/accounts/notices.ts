/** What the last Linked account change did, passed back to the page in its address so it works without JavaScript. */
export const ACCOUNTS_NOTICES = {
  linked: "Linked. Plinth read its balance just now.",
  renewed: "Renewed for 12 months. Plinth read its balance just now.",
  unlinked: "Unlinked. Plinth deleted its copy of that data.",
  refused: "That account has changed since the page loaded, so nothing changed. Try again.",
} as const;

export type AccountsNotice = keyof typeof ACCOUNTS_NOTICES;

/** The notice named in the page's address, or null for none or one that isn't a notice. */
export function accountsNotice(value: string | string[] | undefined): AccountsNotice | null {
  return typeof value === "string" && Object.hasOwn(ACCOUNTS_NOTICES, value) ? (value as AccountsNotice) : null;
}
