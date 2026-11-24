# Rules hold limits, a settings record holds preferences

A customer choice that a guardrail checks before money moves, such as the Buffer or the Payment limit, is a Rule (ADR 0003). Every other choice lives in one versioned settings record per customer. That covers the Autonomy level, the Advice setting, investing risk answers, data choices and goal preferences. Changing either writes a new version and a Decision log entry with the customer as actor. We split them so guardrails read only Rules, and later milestones add preferences without new Rule kinds.
