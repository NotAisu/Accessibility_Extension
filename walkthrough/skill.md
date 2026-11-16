# Use the Skill in your own agent

AI Review and your own agent use the same **Skill**: Allyproof's WCAG review instructions.

- **GitHub Copilot chat and agent mode**: the Skill and the `a11y_check` tool are already there. Ask for example "make this component accessible", or reference the tool with `#a11y_check`. The Skill runs the Check first, so the agent only spends tokens on what the Check cannot decide.
- **Claude Code, Cursor and other agents**: copy the [`skills/allyproof`](https://github.com/NotAisu/Accessibility_Extension/tree/main/skills/allyproof) folder into your project's skills folder, for example `.claude/skills/allyproof/` or `.agents/skills/allyproof/`. These agents use your own subscription.
- **Your repository**: run **Allyproof: Add Skill to Repository** to write the Skill to `.github/skills`, so Copilot code review checks pull requests for accessibility; `.claude/skills` and `.agents/skills` are offered too.
