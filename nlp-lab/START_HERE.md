# Northwest NLP Lab

This folder contains the complete NLP companion project and its presentation materials. Open `Northwest NLP Lab.code-workspace` in VS Code to see only this project instead of the surrounding Planner and TRACE code.

## Find your files

| Folder or file | Contents |
| --- | --- |
| `nlplab/` | Python pipeline, extraction, classifiers, validation, API and browser adapter |
| `src/` | React website and browser Python worker |
| `tests/` and `e2e/` | Python tests and browser workflow tests |
| `scripts/` | Browser resource packaging and production builds |
| `presentation/` | Final team PowerPoint and slide preview |
| `docs/demo/` | Printable live demo guide and editable speaking script |
| `docs/PAGES.md` | GitHub Pages deployment explanation |
| `GIT_GUIDE.md` | Repository, branch, tracking and publishing information |
| `.local/` | Local presentation builders, screenshots and deployment evidence |
| `.lab-data/` | Local SQLite data and trained models |
| `.venv/`, `node_modules/`, `nltk_data/`, `dist/` | Installed dependencies, resources and generated website |

The last three rows contain local or generated material and are excluded from Git. The focused workspace hides those folders from its Explorer so everyday project files are easier to find. They remain available on disk.

## Present the project

Open `presentation/Northwest_NLP_Lab_Team_Presentation.pptx` for the slides. Use `docs/demo/Northwest_NLP_Lab_Live_Demo_Guide.pdf` as the speaking reference, or its `.md` copy for editing.

The public demo is https://chanikya5793.github.io/GDPProject/nlp/. The browser deployment runs Python on the visitor's device. Its data is separate from the local FastAPI service.

## Run on Windows

In a terminal opened in this folder:

```powershell
.\.venv\Scripts\python.exe -m nlplab.cli serve
```

Then open http://127.0.0.1:8001. For fresh installation, development commands, pipeline details and tests, see `README.md`.

## The surrounding repository

This project is part of the existing GDPProject Git repository. Its `.git`, shared workflows and commit hook stay at the repository root. TRACE remains in `../apps/trace`; the main Planner remains in the surrounding repository. These applications are not needed in the focused workspace view.

Older loose Planner presentations and scratch material are preserved in `../.local-artifacts/`. The local move inventory is `.local/file-moves.json`. No files were deleted by the organization step.

Some old output directory remnants are held open by Windows and remain in the hidden `../outputs/` folder. Their moved material is under `../.local-artifacts/other-presentations/`. The focused workspace excludes this surrounding material entirely.
