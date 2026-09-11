// The shapes of what a student can change in Edit Widget.
//
// These mirror the `configuration.parameters` blocks under the expo-widgets
// plugin in app.json — the plugin generates a Swift AppIntent from those, iOS
// renders the edit sheet from it, and the chosen values arrive back here as
// `environment.configuration`. The two must be kept in step by hand; nothing
// checks them against each other at build time, so a rename in app.json that
// is not made here fails silently as an undefined at render.
//
// Enum values must be valid Swift identifiers — the plugin emits them as bare
// `case <value>` — so they are lowercase words with no spaces or punctuation,
// and never a Swift keyword.
//
// Configured widgets require iOS 17. On iOS 16 they simply do not appear in
// the widget gallery, which is why Progress is deliberately left unconfigured:
// it is the one that still works on the 16.4 floor this app supports.

/** Which accent the student picked. Resolved to a hex value inside each layout. */
export type WidgetAccent = 'green' | 'blue' | 'plum' | 'amber';

/** How far ahead a widget looks. */
export type WidgetHorizon = 'today' | 'next3' | 'week';

/** Which kinds of record a widget counts. */
export type WidgetInclude = 'all' | 'tasks' | 'reminders';

export interface DueTodayConfig {
  accent: WidgetAccent;
  horizon: WidgetHorizon;
  include: WidgetInclude;
  density: 'comfortable' | 'compact';
  /** Narrows to high-priority tasks; reminders have no priority and are kept. */
  onlyHigh: boolean;
  /** Only ever narrows: Settings decides whether titles leave the store at all. */
  showTitles: boolean;
}

export interface UpNextConfig {
  accent: WidgetAccent;
  include: WidgetInclude;
  /** A live countdown rather than a clock time. Costs no timeline entries. */
  countdown: boolean;
  showTitles: boolean;
}

export interface ThisWeekConfig {
  accent: WidgetAccent;
  include: WidgetInclude;
  /** Counts everything due, or only what is still outstanding. */
  hideDone: boolean;
}
