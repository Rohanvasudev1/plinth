# Undo posts a reversing transaction

Undo never edits or deletes the original entries. It posts a new ledger transaction in the opposite direction and writes a "Reversed" Decision log entry linked to the original. Each action can be undone once, with no time limit. Undo is refused, with the reason shown, when the destination account no longer holds the amount. This keeps the ledger append-only and answers the brief's question about money that has already moved on.
