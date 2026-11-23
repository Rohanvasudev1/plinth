/** A record that a ledger transaction posted. Rules react to these after the commit. */
export interface LedgerEvent {
  id: number;
  customerId: number;
  ledgerTransactionId: number;
  createdAt: Date;
}

export type LedgerEventSubscriber = (event: LedgerEvent) => void;

/** Hands ledger events to in-process subscribers, after the database transaction that wrote them commits. */
export interface LedgerEventDispatcher {
  /** Adds a subscriber and returns a function that removes it. */
  subscribe(subscriber: LedgerEventSubscriber): () => void;
  dispatch(event: LedgerEvent): void;
}

export function createLedgerEventDispatcher(): LedgerEventDispatcher {
  const subscribers = new Set<LedgerEventSubscriber>();
  return {
    subscribe(subscriber) {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
    dispatch(event) {
      for (const subscriber of [...subscribers]) {
        // The ledger transaction has already committed, so one failing subscriber
        // must not stop the others or make the post look like it failed.
        try {
          subscriber(event);
        } catch (error) {
          console.error(`Ledger event ${event.id} subscriber failed`, error);
        }
      }
    },
  };
}
