# Every read and write is scoped to one customer

Every customer-owned row carries a `customerId`. All reads and writes go through one data-access layer that takes the customer as its first argument, and no other code queries those tables directly. Sign-in is a fake "Sign in as" picker of seeded customers, because real identity checks are out of scope. Tests seed two customers and prove neither can see the other's data.
