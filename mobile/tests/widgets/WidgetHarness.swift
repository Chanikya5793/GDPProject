import SwiftUI
import WidgetKit
#if os(iOS)
import UIKit
#else
import AppKit
#endif

// A standalone simulator app, never included in the production target. It
// exercises the shared store and renders the actual native widget views.
#if os(iOS)
@main
struct WidgetHarness: App {
  var body: some Scene {
    WindowGroup { Text("Widget validation").task { WidgetValidation.run() } }
  }
}
#else
@main
struct WidgetHarness {
  @MainActor static func main() {
    _ = NSApplication.shared
    WidgetValidation.run()
  }
}
#endif

struct WidgetValidation {
  @MainActor static func run() {
    do {
#if os(iOS)
      let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
#else
      let directory = URL(fileURLWithPath: CommandLine.arguments[1])
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
#endif
      PlannerWidgetStore.testDirectory = directory
      var checks = 0
      func check(_ value: @autoclosure () -> Bool, _ message: String) {
        precondition(value(), message)
        checks += 1
      }
      let calendar = Calendar(identifier: .gregorian)
      let now = calendar.date(from: DateComponents(year: 2026, month: 9, day: 17, hour: 11, minute: 20))!
      let sample = PlannerWidgetTimeline.sample(at: now)
      try PlannerWidgetStore.transact { $0 = sample }
      let first = sample.snapshot!.items[0]
      func complete(_ item: PlannerWidgetItem, owner: String = "preview") throws {
        try PlannerWidgetStore.complete(owner: owner, key: item.key, revision: item.revision, date: item.date, time: item.time)
      }
      try complete(first)
      check(PlannerWidgetStore.read().commands.count == 1, "Completion must survive a new disk read")
      check(PlannerWidgetStore.read().items.first!.done, "Completion must overlay the shared snapshot")
      try complete(first)
      check(PlannerWidgetStore.read().commands.count == 1, "Repeated completion must be idempotent")
      try complete(sample.snapshot!.items[1], owner: "another-account")
      check(PlannerWidgetStore.read().commands.count == 1, "Stale account must not mutate shared state")
      let command = PlannerWidgetStore.read().commands[0]
      try PlannerWidgetStore.undo(owner: "preview", commandId: command.id)
      check(PlannerWidgetStore.read().commands.isEmpty, "Undo must remove the durable completion")
      check(!PlannerWidgetStore.read().items.first!.done, "Undo must restore outstanding item")
      try complete(first)
      try PlannerWidgetStore.transact { $0.commands[0].claimed = true }
      try PlannerWidgetStore.undo(owner: "preview", commandId: PlannerWidgetStore.read().commands[0].id)
      check(PlannerWidgetStore.read().commands.count == 1, "An in-flight completion cannot be undone concurrently")
      try PlannerWidgetStore.transact { $0 = sample; $0.snapshot!.items[0].date = "2026-09-20" }
      try complete(first)
      check(PlannerWidgetStore.read().commands.isEmpty, "A stale displayed row must not complete a rescheduled record")
      check(PlannerWidgetStore.read().notice != nil, "Stale action must be explained")
      try PlannerWidgetStore.transact { $0 = sample }
      try PlannerWidgetStore.select(owner: "preview", key: "day", value: "2026-09-19")
      check(PlannerWidgetStore.read().selections["day"] == "2026-09-19", "Day selection must persist")
      let allDay = sample.snapshot!.items[2]
      check(!allDay.isOverdue(at: now), "Date-only work must not become overdue in the morning")
      check(allDay.isOverdue(at: calendar.date(byAdding: .day, value: 1, to: now)!), "Date-only work becomes overdue next day")
      var invalid = first
      invalid.date = "2026-02-30"
      check(invalid.scheduled() == nil, "Invalid dates must not roll into a different month")
      var leap = first
      leap.date = "2028-02-29"
      check(leap.scheduled() != nil, "Leap dates must remain valid")
      var timezoneCalendar = Calendar(identifier: .gregorian)
      timezoneCalendar.timeZone = TimeZone(identifier: "America/Chicago")!
      var dst = first
      dst.date = "2026-11-01"; dst.time = "23:30"
      let components = timezoneCalendar.dateComponents([.day, .hour], from: dst.scheduled(calendar: timezoneCalendar)!)
      check(components.day == 1 && components.hour == 23, "DST must preserve the local deadline")
      try PlannerWidgetStore.transact { $0 = sample }
      let many = (0..<40).map { index -> PlannerWidgetItem in var item = first; item.id = "concurrent-\(index)"; return item }
      try PlannerWidgetStore.transact { $0.snapshot!.items += many }
      DispatchQueue.concurrentPerform(iterations: many.count) { index in
        let item = many[index]
        try! PlannerWidgetStore.complete(owner: "preview", key: item.key, revision: item.revision, date: item.date, time: item.time)
      }
      check(PlannerWidgetStore.read().commands.count == many.count, "Concurrent taps must not overwrite one another")
      let runtimeNow = Date()
      let dense = (0..<80).map { index -> PlannerWidgetItem in
        var item = first
        item.id = "deadline-\(index)"
        let due = runtimeNow.addingTimeInterval(Double(index + 1) * 60)
        item.date = PlannerWidgetTimeline.dateKey(due)
        let formatter = DateFormatter(); formatter.dateFormat = "HH:mm"
        item.time = formatter.string(from: due)
        return item
      }
      try PlannerWidgetStore.transact { $0 = sample; $0.snapshot!.items = dense }
      let entries = PlannerWidgetTimeline.entries(options: PlannerWidgetOptions())
      check(entries.count <= 48, "Busy days must keep timelines bounded")
      let midnight = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: runtimeNow))!
      check(entries.contains { $0.date == midnight }, "Midnight must survive a crowded timeline")
      check(entries.first!.state.items.count == 80, "Timeline limits must not truncate the underlying records")
      try PlannerWidgetStore.transact { $0 = PlannerWidgetState() }
      check(PlannerWidgetStore.read().snapshot == nil && PlannerWidgetStore.read().commands.isEmpty, "Sign-out must clear records and actions")

      let variants: [(String, WidgetFamily, CGFloat, CGFloat)] = [
        ("DueToday", .systemSmall, 170, 170), ("DueToday", .systemMedium, 364, 170),
        ("DueToday", .systemLarge, 364, 382), ("UpNext", .systemSmall, 170, 170),
        ("UpNext", .systemMedium, 364, 170), ("UpNext", .systemLarge, 364, 382),
        ("ThisWeek", .systemMedium, 364, 170), ("ThisWeek", .systemLarge, 364, 382),
        ("Progress", .systemSmall, 170, 170), ("Progress", .systemMedium, 364, 170),
        ("DueToday", .systemExtraLarge, 720, 382),
      ]
      for mode in ["light", "dark", "pending", "private", "empty", "large-text"] {
        var state = sample
        if mode == "pending" {
          state.commands = [PlannerWidgetCommand(id: "pending", owner: "preview", kind: first.kind,
            recordId: first.id, revision: first.revision, date: first.date, time: first.time,
            createdAt: now.timeIntervalSince1970 * 1000)]
        }
        if mode == "private" { state.snapshot!.titlesAllowed = false; for index in state.snapshot!.items.indices { state.snapshot!.items[index].title = "" } }
        if mode == "empty" { state.snapshot!.items = [] }
        for (kind, family, width, height) in variants {
          let entry = PlannerEntry(date: now, state: state, options: PlannerWidgetOptions(), preview: true)
          let content = PlannerWidgetView(entry: entry, kind: kind, familyOverride: family)
            .environment(\.colorScheme, mode == "dark" ? .dark : .light)
            .environment(\.dynamicTypeSize, mode == "large-text" ? .accessibility2 : .large)
            .padding(16).frame(width: width, height: height)
            .background(mode == "dark" ? Color(red: 0.07, green: 0.105, blue: 0.12) : Color(red: 0.97, green: 0.98, blue: 0.96))
            .clipShape(RoundedRectangle(cornerRadius: 24))
          let renderer = ImageRenderer(content: content)
          renderer.scale = 2
#if os(iOS)
          guard let image = renderer.uiImage, let png = image.pngData() else { fatalError("Could not render \(kind)") }
#else
          guard let image = renderer.cgImage,
                let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { fatalError("Could not render \(kind)") }
#endif
          let familyName = String(describing: family)
          try png.write(to: directory.appendingPathComponent("\(kind)-\(familyName)-\(mode).png"))
        }
      }
      try "\(checks) native checks passed; 66 native layout renders completed.\n".write(to: directory.appendingPathComponent("result.txt"), atomically: true, encoding: .utf8)
    } catch { fatalError("Widget validation failed: \(error)") }
  }
}
