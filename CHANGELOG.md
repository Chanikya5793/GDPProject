# Changelog

All notable changes to the Northwest Student Planner are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-05-31

Builds on v1.0.0 with 10 resolved issues, a companion mobile app, and smart
schedule optimization.

### Added
- **Note attachments** (#1) — attach images/PDFs/code to notes, with thumbnails,
  download & remove. Files are stored in browser storage with a 2 MB per-file
  cap and graceful out-of-storage handling.
- **Calendar category filter** (#6) — filter tasks by category across all views.
- **Day panel in every calendar view** (#7) — previously only Month; time-grid
  column headers are now clickable to open the panel.
- **Quick-add from calendar** (#12) — "+ Task" / "+ Reminder" buttons in the day
  panel, pre-filled with the selected date.
- **Editable tag colors** (#9) — preset swatches plus a custom color picker for
  both new and existing tags.
- **Compact mode density** (#13) — now tightens task, reminder, note, and
  dashboard tiles, not just page chrome.
- **Session activity log** (#14) — Settings shows a create/update/delete history
  grouped by session.
- **Delete confirmations** (#15) — for tasks, reminders, and notes.
- **Double-click-to-edit tiles** (#16) — on tasks and reminders.
- **Priority escalation & schedule optimization** — deadline-based visual
  priority escalation, overloaded-day detection, and pull-forward rescheduling
  suggestions.
- **Companion mobile app** — Expo / React Native build under `mobile/`.

### Fixed
- AI assistant widget no longer disappears when the dashboard layout is reset
  while the assistant is popped out (#8).

### Deployment
- Live at <https://chanikya5793.github.io/GDPProject/> via GitHub Pages,
  deployed from `main`.

## [1.0.0] - 2026-05-26

First production release of the Northwest Student Planner — a localStorage-backed
React SPA for managing academic tasks, reminders, notes, and schedules.

### Added
- **Dashboard** — widget-based layout with drag-to-reorder, pinned notes, AI chat
  widget, analytics charts, and quick-add modals.
- **Calendar** — multi-view (day / 3-day / work week / week / month) with
  drag-and-drop rescheduling, hover tooltips, double-click-to-edit, and inline
  editing.
- **Tasks** — full CRUD with priorities, categories, due dates, and completion
  tracking.
- **Reminders** — time-based reminders with calendar integration.
- **Notes** — markdown-supported notes with tagging, pin-to-dashboard, and
  expand/collapse.
- **AI Assistant** — collapsible sidebar and pop-out dashboard widget with demo
  chat.
- **Settings** — theme (light/dark/system), accent colors, font size, compact
  mode, reduced motion, planner defaults, data export, and recycle bin with
  restore.
- **Trash / Restore** — soft-delete across tasks, reminders, and notes.

[1.1.0]: https://github.com/Chanikya5793/GDPProject/releases/tag/v1.1.0
[1.0.0]: https://github.com/Chanikya5793/GDPProject/releases/tag/v1.0.0
