# Rules are versioned, typed data

A Rule is a row with a `kind`, typed JSON parameters checked by a schema, an on/off switch, and a version. Editing a Rule creates a new version. The survey writes Rules, the agent and guardrails read the same rows, and every Decision log entry records the Rule id and version it used, so old entries still explain themselves after the Rule changes.
