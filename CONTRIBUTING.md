# Contributing

## Commit hygiene

Coding assistants append a `Co-Authored-By` trailer, a session link, or a
"Generated with" line by default. This project does not carry them. Once such a
line is pushed, removing it means rewriting published history and force-pushing,
which breaks every other clone, so it is worth catching early.

Enable the hooks once per clone:

```bash
git config core.hooksPath .githooks
```

`.githooks/commit-msg` strips those lines from the message as you commit. CI
enforces the same rule on every pull request, so a clone that never ran the
command still cannot merge one.

Local assistant configuration (`.claude/`, `CLAUDE.md`, `.codex/`) is ignored and
must stay untracked.
