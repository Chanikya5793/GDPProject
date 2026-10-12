# Native planner widgets

Due Today is a paged agenda with deadline and priority filters, task and reminder
completion, quick capture, and upcoming work when there is space. Up Next shows
the next outstanding deadline with a live countdown. This Week lets you select
a day and inspect its agenda. Progress shows completion for records due today,
along with overdue and undated work on its medium Home Screen layout.

The agenda and Up Next support small, medium, large and extra-large sizes. The
week view supports medium, large and extra-large. Progress supports small and
medium Home Screen sizes plus the existing Lock Screen families. Extra-large
widgets use two columns. The configurable widgets and their buttons require
iOS 17; Progress retains the app's iOS 16.4 floor.

## Use the widgets

1. Install the updated native app and open it while signed in.
2. Titles and categories are shown by default; they are copied to shared device
   storage for the widget process. Settings → Widgets & Siri turns that off for
   counts and times only. Notes and attachments are never exported.
3. Add NW Planner widgets from the system widget gallery. Hold a configurable
   widget and choose Edit Widget to select sources, horizon, priority ordering,
   overdue/undated work, density, accent and title visibility where applicable.
4. On iOS, tapping a checkbox completes the item in the widget immediately
   and saves a durable command without opening the app. Undo is available
   before the app claims a command. When the planner next opens, the app records
   the change in its encrypted cache/outbox and attempts cloud sync. Another
   device receives it when its app launches, resumes or is refreshed.
5. Tap a title to open that exact task or reminder. The week view's Open day link
   opens the selected date in the calendar. The plus actions open the existing
   creation forms.

Existing widget instances retain their system configuration, including any
previously disabled Show titles setting. The app's title permission remains the
upper limit regardless of per-widget settings.

## Implementation

`utils/widgetSnapshot.ts` exports one minimized record set. It includes all
records needed for accurate filtering and progress, including completed and
undated work. Date-only deadlines remain all-day. No timestamp at 9 AM is
invented. Dates are interpreted in the device's local timezone with the
Gregorian calendar used by the app's stored date strings.

The config plugin keeps the existing widget target, bundle identifier, App
Group, configuration intent names and Live Activity. It replaces the old
JavaScript planner widget layouts with SwiftUI. Expo still owns the Study
Session Live Activity.

`PlannerWidgetStore.swift` and `PlannerWidgetIntents.swift` are compiled into
both the app and extension. The containing app registers the same three
interaction intents used by archived widget buttons. Completion does not
request foreground execution. All-day and unscheduled actions have optional
date/time inputs, so iOS does not try to resolve absent fields. The app build
number forces a timeline reload after upgrading, even when records are unchanged.

The shared store uses a file lock and atomic replacement to coordinate
snapshots, pending commands and view selections across processes. Commands contain an opaque account identifier,
record kind and ID, revision and schedule preconditions. A stale widget cannot
complete a rescheduled or revised record. Repeated completion is idempotent.
Claimed commands cannot be undone concurrently with an app mutation.

`api/widgets.ts` serializes publishing, command reconciliation and sign-out
clearing. Initial account restoration preserves pending taps. Account changes
invalidate asynchronous work. Native completion intents require authentication.
The app checks for pending actions while active and refreshes on foreground,
planner changes and persisted title-permission changes. The old Expo widget
snapshots are removed during migration and sign-out.

Native timeline providers calculate fresh views from the shared snapshot after
the app closes. Timeline dates include deadlines and a reserved midnight
rollover, with at most 48 entries. The record set itself is not truncated.
Cloud snapshots older than an hour ask the user to refresh. Publication time is separate from the last successful cloud refresh. iOS controls refresh timing;
the widgets do not fetch new cloud records while the app is closed.

## Additional iOS widgets (October 10, 2026)

- Overdue: unfinished records with missed deadlines.
- High Priority: all unfinished high-priority tasks, including undated work.
- Tomorrow: tasks and reminders for the next local calendar day.
- Unscheduled: unfinished work without a date.
- Reminders: a dedicated list of outstanding reminders.
- Quick Capture: new task and reminder forms, plus new notes in medium size.

The first five support small, medium and large Home Screen widgets and inline
and rectangular Lock Screen widgets. Quick Capture supports small and medium.
All six use native SwiftUI and require iOS 17. No new cloud infrastructure is
needed. Synthetic renders are in [the visual gallery](widgets-preview.html).

## iOS launch, sync and cost boundary

Screens read the existing encrypted device cache immediately. `DeviceSync`
refreshes all three record kinds in parallel on launch/resume; automatic attempts
within 30 seconds share/skip the previous attempt. Pull-to-refresh forces a
refresh and shares any in-flight work. There is no timer polling the cloud.
The three-second widget inbox check reads a local native file only; finding a
new command triggers the ordinary cloud sync.

Outbox replay is coalesced. A transient/auth/rate-limit failure retains queued
changes. Rejected changes are kept encrypted under `nw_sync_conflicts`; Settings
can open the cloud item, restore the saved content as a new item, or dismiss it.
Fresh data cannot overwrite still-queued edits or resurrect queued deletions.
Unchanged cache contents do not emit change events. Identical native snapshots
do not request timeline reloads, except when needed to renew the freshness label.

A 30-second request deadline covers Firebase token retrieval, fetch and JSON
body parsing. AI indexing no longer blocks a successfully saved item. The
signup-policy warm-up request was removed. Cloud sync status and the last
successful account-refresh time are visible on the dashboard and in widgets.

Read-only checks on October 10 confirmed billing is enabled on the existing
`nw-student-planner` project. `planner-api` has no minimum-instance setting;
that is consistent with cold starts after idle periods, not a measured launch
latency. The configured maximum instance count is 10. No service, billing,
quota, IAM or deployment settings were changed. Actual spend was not retrieved.
Existing Cloud Run, Firestore, KMS and AI usage may still incur charges.
The user explicitly chose to keep existing sync, reduce requests and add no paid
services. These changes cannot guarantee that the existing cloud bill is zero.

## Validation

October 10 local checks: TypeScript, 420 mobile tests, iOS JavaScript export,
43 native store/timeline/filter/reload/intent checks, and 196 native SwiftUI
layout renders across light/dark, pending, private, empty, accessibility text
and interactive-button states.
The complete arm64 Simulator app and embedded widget extension build passed. Details are recorded in
[the repair report](IOS_SYNC_REPAIR.html).

The layout gallery contains 168 synthetic native view renders. Additional
validation renders actual interactive buttons. A separately installed simulator
fixture verified Home Screen completion of all-day and undated items, Undo,
paging, and completion with its containing app terminated. Day selection passed
the native intent test; its Home Screen UI check was not completed because the
automation connection became unstable. These checks do not establish physical
device or cross-device cloud-sync behavior. Signed App Store IPA 1.0.0 (42)
passed signature, provisioning and extracted action-registration checks.
Apple accepted build 42 as VALID and IN_BETA_TESTING for the existing internal
group. Testing notes are saved. Update in TestFlight and open the planner once
to refresh existing widget actions. Evidence is in `TESTFLIGHT_BUILD_42.json`.

```sh
npm run typecheck
npm test
npx expo export --platform ios --output-dir /tmp/nw-widget-export
npx expo prebuild --platform ios --no-install
cd ios && pod install && cd ..
xcodebuild -workspace ios/NWStudentPlanner.xcworkspace \
  -scheme NWStudentPlanner -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
# Boot an Apple Silicon iOS simulator before running:
bash scripts/validate-native-widgets.sh
```

The Swift harness tests durable completion, replay, wrong-account rejection,
undo, concurrent taps, stale records, invalid dates, leap dates, DST, midnight
reservation and clearing. It renders the actual SwiftUI Home Screen views in
light, dark, pending, private, empty and larger-text states. Sample records are
synthetic. These are native view renders in a simulator host, not screenshots
of widgets installed on SpringBoard.

Before release, use a physical device to confirm Home Screen and Lock Screen
placement, native intent dispatch while the app is terminated, authentication,
VoiceOver, tinted appearance, cold-launch reconciliation, offline completion,
sign-out clearing, timezone changes and cloud conflict recovery. Simulator
builds and native store tests do not establish those physical-device results.

SDK references: [Expo SDK 57 widgets](https://docs.expo.dev/versions/v57.0.0/sdk/widgets/)
and [Apple interactive widgets](https://developer.apple.com/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities).

## Build 41 interaction regression

Build 41 attempted to foreground an intent registered only in the extension.
The signed IPA fails `python3 scripts/verify-ios-widget-package.py <ipa>`, which
checks Apple's extracted action metadata rather than rendered previews. The
repair shares action definitions between both targets and restores local
completion. Native validation now executes completion, undo, page and day
intents and covers all-day/undated commands as well as app-upgrade reloads.
Build 42 passes the signed-package check. Run this package check on every
signed release before uploading to TestFlight.
