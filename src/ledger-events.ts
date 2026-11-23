/** A record that a ledger transaction posted. Rules react to these after the commit. */
export interface LedgerEvent {
  id: number;
  customerId: number;
  ledgerTransactionId: number;
  createdAt: Date;
}

export type LedgerEventSubscriber = (event: LedgerEvent) => void;

/**
 * Hands ledger events to in-process subscribers, after the database transaction that wrote them commits.
 * Every subscriber sees events in the order they were dispatched: an event dispatched by a subscriber, such
 * as a sweep posted in reaction to a paycheck, waits until every subscriber has had the current one.
 */
export interface LedgerEventDispatcher {
  /** Adds a subscriber and returns a function that removes it. */
  subscribe(subscriber: LedgerEventSubscriber): () => void;
  dispatch(event: LedgerEvent): void;
}

export function createLedgerEventDispatcher(): LedgerEventDispatcher {
  const subscribers = new Set<LedgerEventSubscriber>();
  const queue: LedgerEvent[] = [];
  let dispatching = false;

  function deliver(event: LedgerEvent): void {
    for (const subscriber of [...subscribers]) {
      // The ledger transaction has already committed, so one failing subscriber
      // must not stop the others or make the post look like it failed.
      try {
        subscriber(event);
      } catch (error) {
        console.error(`Ledger event ${event.id} subscriber failed`, error);
      }
    }
  }

  return {
    subscribe(subscriber) {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
    dispatch(event) {
      queue.push(event);
      if (dispatching) return;
      dispatching = true;
      try {
        for (let next = queue.shift(); next; next = queue.shift()) deliver(next);
      } finally {
        dispatching = false;
      }
    },
  };
}
