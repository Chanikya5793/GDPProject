# Git information

This is a subproject of **Chanikya5793/GDPProject**, not a separate nested Git repository.

- Repository: https://github.com/Chanikya5793/GDPProject
- NLP source branch: `codex/nlp-pages`
- Project directory inside Git: `nlp-lab/`
- Live application: https://chanikya5793.github.io/GDPProject/nlp/
- Shared CI: `../.github/workflows/ci.yml`
- NLP CI: `../.github/workflows/nlp-lab.yml`
- Pages packaging: `../.github/workflows/deploy.yml`
- Commit hook: `../.githooks/commit-msg`

## Useful commands

Run from this project folder:

```powershell
git status
git branch --show-current
git remote -v
git diff -- .
```

Before committing, inspect changes. Track source, documentation, tests, package lockfiles and intentional final presentation files. Keep local databases, model artifacts, imported records, environments, generated website files and scratch evidence untracked through `.gitignore`. The `.local/` directory may contain machine-specific paths and diagnostic evidence; do not publish it.

The parent repository already owns Git history. Do not run `git init` in this folder and do not move its parent `.git` directory here. Enable the existing hook from the repository root with `git config core.hooksPath .githooks` if setting up a fresh clone. Follow the parent `CONTRIBUTING.md` for commit hygiene.

The independent NLP branch is published without a PR into main. Main contains the shared Pages packaging integration, which combines the tested NLP artifact with Planner and TRACE. Changes pushed to the NLP branch must pass the existing required checks and the NLP pipeline, interface and browser checks. See `docs/PAGES.md` before publishing.

The folder organization and documentation changes are local working-tree changes until explicitly committed and pushed. Organizing these files does not redeploy the live website.
