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
2. In Settings, open Widgets & Siri. Enable titles for detailed agendas if you
   want titles and categories copied to shared device storage. Notes and
   attachments are never exported.
3. Add NW Planner widgets from the system widget gallery. Hold a configurable
   widget and choose Edit Widget to select sources, horizon, priority ordering,
   overdue/undated work, density, accent and title visibility where applicable.
4. Tap a checkbox to save a completion. The widget marks the change as saved
   locally. Undo is available until the app starts applying it. Open the app to
   apply changes through its encrypted cache, audit log and normal sync outbox.
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

`PlannerWidgetStore.swift` is compiled into the app and extension. A file lock
and atomic replacement coordinate snapshots, pending commands and view
selections across processes. Commands contain an opaque account identifier,
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
Snapshots older than a day ask the user to refresh. iOS controls refresh timing;
the widgets do not fetch new cloud records while the app is closed.

## Validation

Local validation on September 17, 2026 passed TypeScript checking, 369 mobile
tests, the iOS JavaScript export, a complete arm64 iOS Simulator app and widget
extension build with Xcode 27, and 20 native store/timeline checks. The harness
produced 66 native renders. [Open the visual gallery](widgets-preview.html).

The native target was regenerated from the config plugins during validation.
No production deployment, App Store submission or physical-device installation
was performed.

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
