// No database imports here: the schema reads ACCESS_READERS.

/**
 * Who read the customer's data: their agent, Plinth itself (such as a Sync), or the customer, such as an Export.
 * `access-log-text.ts` names each one for the customer.
 */
export const ACCESS_READERS = ["agent", "plinth", "customer"] as const;
export type AccessReader = (typeof ACCESS_READERS)[number];

/** One access log entry as written: who read the customer's data, what they read and why. Built by `access-log-text.ts`. */
export interface NewAccessLogEntry {
  who: AccessReader;
  what: string;
  why: string;
}

/** One read of the customer's data by anything other than their own page views (ADR 0010), timed by the simulated clock. */
export interface AccessLogEntry extends NewAccessLogEntry {
  id: number;
  at: Date;
}
