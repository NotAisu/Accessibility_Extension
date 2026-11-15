# Ignore and configure rules

- **Ignore one Finding**: the quick fix **Ignore this Finding** puts a comment on the line above it, `<!-- allyproof-ignore <rule id> -->` (in JSX `{/* allyproof-ignore <rule id> */}`).
- **Turn a rule off**: the quick fix **Disable rule** sets it to `off` in `allyproof.rules`. The same setting changes a rule's severity, for example `{ "image-alt": "error" }`. Check Findings are warnings by default.
- **Fix on save**: `allyproof.check.fixOnSave` applies the Check's fixes that guess nothing when you save. It is off by default: Allyproof never changes your code unless you ask.
