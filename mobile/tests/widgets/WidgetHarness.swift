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
    WindowGroup { Text("Widget validation").task { await WidgetValidation.run() } }
  }
}
#else
@main
struct WidgetHarness {
  @MainActor static func main() async {
    _ = NSApplication.shared
    await WidgetValidation.run()
  }
}
#endif

/// Answers the extension's cloud requests in-process.
final class MockCloud: URLProtocol {
  nonisolated(unsafe) static var routes: [String: (Int, String)] = [:]
  nonisolated(unsafe) static var seen: [String] = []
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    let url = request.url!
    let key = "\(request.httpMethod ?? "GET") \(url.host ?? "")\(url.path)"
    MockCloud.seen.append(key)
    guard let (status, body) = MockCloud.routes[key] else {
      client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)); return
    }
    client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!,
                        cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data(body.utf8))
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}

struct WidgetValidation {
  @MainActor static func run() async {
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

      var refreshed = sample.snapshot!
      refreshed.cloudUpdatedAt = now.timeIntervalSince1970 * 1000
      check(try! PlannerWidgetStore.publish(refreshed), "The first snapshot must request a reload")
      refreshed.updatedAt += 10_000
      check(!(try! PlannerWidgetStore.publish(refreshed)), "Unchanged local publication must not request a reload")
      refreshed.cloudUpdatedAt! += 10_000
      check(!(try! PlannerWidgetStore.publish(refreshed)), "Unchanged cloud records must not request repeated reloads")
      refreshed.items[0].title = "Updated on another device"
      check(try! PlannerWidgetStore.publish(refreshed), "A changed record must request a reload")
      refreshed.cloudError = true
      check(try! PlannerWidgetStore.publish(refreshed), "Offline status must request a reload")
      let legacy = "{\"schema\":1,\"owner\":\"old\",\"updatedAt\":1,\"titlesAllowed\":false,\"items\":[]}"
      let decoded = try JSONDecoder().decode(PlannerWidgetSnapshot.self, from: Data(legacy.utf8))
      check(decoded.cloudUpdatedAt == nil, "Older installed snapshots must still decode")
      var tomorrowItem = first
      tomorrowItem.id = "tomorrow"; tomorrowItem.title = "Prepare tomorrow’s lab"
      tomorrowItem.date = PlannerWidgetTimeline.dateKey(calendar.date(byAdding: .day, value: 1, to: now)!)
      var undatedItem = first
      undatedItem.id = "undated"; undatedItem.title = "Pick a topic for final paper"; undatedItem.date = ""; undatedItem.time = ""
      var overdueItem = first
      overdueItem.id = "overdue"; overdueItem.title = "Upload the reading response"
      overdueItem.date = PlannerWidgetTimeline.dateKey(calendar.date(byAdding: .day, value: -1, to: now)!)
      var completeItem = overdueItem
      completeItem.id = "finished"; completeItem.done = true
      var reminderItem = tomorrowItem
      reminderItem.id = "reminder"; reminderItem.kind = "reminder"; reminderItem.priority = ""
      let modes = [tomorrowItem, undatedItem, overdueItem, completeItem, reminderItem]
      func ids(_ kind: String) -> Set<String> {
        Set(PlannerWidgetContent.queue(items: modes, options: PlannerWidgetOptions(), kind: kind, at: now).map(\.id))
      }
      check(ids("Overdue") == ["overdue"], "Overdue must omit undated and completed work")
      check(ids("Tomorrow") == ["tomorrow", "reminder"], "Tomorrow must only show the next local day")
      check(ids("Unscheduled") == ["undated"], "Unscheduled must only show undated unfinished work")
      check(ids("HighPriority") == ["tomorrow", "undated", "overdue"], "High priority must include undated high tasks but no reminders")
      check(ids("Reminders") == ["reminder"], "Reminders must omit tasks")
      check(!CompletePlannerWidgetIntent.openAppWhenRun, "Completion must run in the widget without launching the app")
      try PlannerWidgetStore.transact { $0 = sample }
      _ = try await CompletePlannerWidgetIntent(owner: "preview", item: first).perform()
      check(PlannerWidgetStore.read().commands.count == 1, "The actual completion intent must persist the action")
      check(PlannerWidgetTimeline.entries(options: PlannerWidgetOptions()).first!.state.items.first!.done,
        "The timeline reloaded after the intent must show the completed item")
      let intentCommand = PlannerWidgetStore.read().commands[0]
      _ = try await UndoPlannerWidgetIntent(owner: "preview", commandId: intentCommand.id).perform()
      check(!PlannerWidgetStore.read().items.first!.done, "The actual undo intent must restore the item")
      _ = try await SelectPlannerWidgetIntent(owner: "preview", key: "page", value: "1").perform()
      _ = try await SelectPlannerWidgetIntent(owner: "preview", key: "week:day", value: "2026-09-19").perform()
      check(PlannerWidgetStore.read().selections["page"] == "1", "The actual page intent must persist selection")
      check(PlannerWidgetStore.read().selections["week:day"] == "2026-09-19", "The actual day intent must persist selection")
      try PlannerWidgetStore.transact { $0 = sample; $0.snapshot!.items.append(undatedItem) }
      let undatedIntent = CompletePlannerWidgetIntent(owner: "preview", item: undatedItem)
      check(undatedIntent.date == nil && undatedIntent.time == nil, "Unscheduled actions must omit optional date/time inputs")
      _ = try await undatedIntent.perform()
      check(PlannerWidgetStore.read().commands.first!.date.isEmpty, "An unscheduled action must persist without asking for a date")
      let allDayIntent = CompletePlannerWidgetIntent(owner: "preview", item: allDay)
      check(allDayIntent.time == nil, "All-day actions must not require a missing time")
      _ = try await allDayIntent.perform()
      check(PlannerWidgetStore.read().commands.count == 2, "An all-day completion must run without a time")
      check(try! PlannerWidgetStore.publish(sample.snapshot!, build: "42"), "An app update must invalidate old archived widget actions")
      check(!(try! PlannerWidgetStore.publish(sample.snapshot!, build: "42")), "Unchanged data within the same build must not reload again")

      // MARK: the extension's own cloud path
      let mapped = PlannerWidgetRecords.item(PlannerWidgetServerRecord(record_id: "0042", revision: 3,
        content: .init(entity_type: "task", title: "  Lab report  ", due_date: "2026-09-18", due_time: "09:30",
          date: nil, time: nil, priority: "high", category: "Lab", completed: false)), titlesAllowed: true)!
      check(mapped.id == "42" && mapped.title == "Lab report" && mapped.time == "09:30" && mapped.revision == 3,
        "Server records must map like the app's snapshot, numeric ids included")
      let hidden = PlannerWidgetRecords.item(PlannerWidgetServerRecord(record_id: "r1", revision: 1,
        content: .init(entity_type: "reminder", title: "Secret", due_date: nil, due_time: nil,
          date: "2026-09-18", time: nil, priority: nil, category: "x", completed: false)), titlesAllowed: false)!
      check(hidden.title.isEmpty && hidden.category.isEmpty, "Without consent no title or category may be stored")
      check(PlannerWidgetRecords.item(PlannerWidgetServerRecord(record_id: "bad", revision: 1,
        content: .init(entity_type: "task", title: "x", due_date: "2026-02-30", due_time: nil,
          date: nil, time: nil, priority: nil, category: nil, completed: nil)), titlesAllowed: true) == nil,
        "Malformed dates must be dropped, as the app drops them")
      var localEdit = first; localEdit.pending = true; localEdit.title = "Edited offline"
      let merged = PlannerWidgetRecords.merge([PlannerWidgetServerRecord(record_id: first.id, revision: 1,
        content: .init(entity_type: "task", title: "Server copy", due_date: first.date, due_time: first.time,
          date: nil, time: nil, priority: "high", category: "", completed: false))], into: [localEdit], titlesAllowed: true).items
      check(merged.count == 1 && merged[0].title == "Edited offline", "An unsynced local edit must survive a cloud read")
      var newer = first; newer.done = true; newer.revision = 5
      let raced = PlannerWidgetRecords.merge([PlannerWidgetServerRecord(record_id: first.id, revision: 4,
        content: .init(entity_type: "task", title: "x", due_date: first.date, due_time: first.time,
          date: nil, time: nil, priority: "high", category: "", completed: false))], into: [newer], titlesAllowed: true)
      check(raced.items[0].done && raced.overtaken, "A fetch that predates a widget completion must not undo the tick")

      let configuration = URLSessionConfiguration.ephemeral
      configuration.protocolClasses = [MockCloud.self]
      await PlannerWidgetCloud.coordinator.use(URLSession(configuration: configuration))
      PlannerWidgetKeychain.testCredential = PlannerWidgetCredential(uid: "alice", owner: "preview", refreshToken: "refresh",
        apiKey: "key", projectId: "demo", database: "(default)", apiUrl: "https://api.test", bundleId: "app")
      let marker = "GET firestore.googleapis.com/v1/projects/demo/databases/(default)/documents/users/alice/meta/sync"
      MockCloud.routes = [
        "POST securetoken.googleapis.com/v1/token": (200, #"{"id_token":"id","expires_in":"3600","user_id":"alice","refresh_token":"refresh"}"#),
        marker: (200, #"{"fields":{"version":{"integerValue":"7"}}}"#),
        "GET api.test/v1/records/task": (200, #"[{"record_id":"t9","revision":2,"content":{"entity_type":"task","title":"Made on the laptop","due_date":"2026-09-17","priority":"medium","category":"Homework","completed":false}}]"#),
        "GET api.test/v1/records/reminder": (200, "[]"),
      ]
      try PlannerWidgetStore.transact { $0 = sample }
      await PlannerWidgetCloud.refresh()
      var fetched = PlannerWidgetStore.read()
      check(fetched.snapshot!.items.map(\.id) == ["t9"] && fetched.cloudMarker == 7,
        "A moved marker must replace the widget's records with the account's")
      check(fetched.snapshot!.cloudUpdatedAt != nil, "A cloud read must count as fresh")
      MockCloud.seen = []
      await PlannerWidgetCloud.refresh()
      check(MockCloud.seen.isEmpty, "Ten kinds reloading together must share one check")
      await PlannerWidgetCloud.refresh(force: true)
      check(MockCloud.seen == [marker], "An unchanged marker must cost one document read, no list reads")

      let t9 = fetched.snapshot!.items[0]
      try PlannerWidgetStore.complete(owner: "preview", key: t9.key, revision: t9.revision, date: t9.date, time: t9.time)
      MockCloud.routes["POST api.test/v1/records/task/t9/complete"] =
        (200, #"{"record_id":"t9","revision":3,"content":{"entity_type":"task","title":"Made on the laptop","completed":true}}"#)
      await PlannerWidgetCloud.complete(commandId: PlannerWidgetStore.read().commands[0].id)
      fetched = PlannerWidgetStore.read()
      check(fetched.commands.isEmpty && fetched.snapshot!.items[0].done && fetched.snapshot!.items[0].revision == 3,
        "A sent completion must leave nothing for the app to replay")

      try PlannerWidgetStore.transact { $0.snapshot!.items[0].done = false; $0.snapshot!.items[0].revision = 2 }
      try PlannerWidgetStore.complete(owner: "preview", key: t9.key, revision: 2, date: t9.date, time: t9.time)
      MockCloud.routes["POST api.test/v1/records/task/t9/complete"] = nil
      await PlannerWidgetCloud.complete(commandId: PlannerWidgetStore.read().commands[0].id)
      fetched = PlannerWidgetStore.read()
      check(fetched.commands.count == 1 && fetched.commands[0].sendingAt == nil && !fetched.commands[0].claimed,
        "Offline, the completion must stay queued and released for the app's outbox")
      check(!PlannerWidgetCommand(id: "c", owner: "o", kind: "task", recordId: "1", revision: 1, date: "", time: "",
        createdAt: 0, sendingAt: Date().timeIntervalSince1970 * 1000 - 40_000).sending(at: Date()),
        "A send the extension abandoned must become the app's after 30 s")

      MockCloud.routes["POST api.test/v1/records/task/t9/complete"] = (409, #"{"detail":"changed","code":"stale_revision"}"#)
      await PlannerWidgetCloud.complete(commandId: PlannerWidgetStore.read().commands[0].id)
      check(PlannerWidgetStore.read().commands.isEmpty && PlannerWidgetStore.read().notice != nil,
        "A completion refused as stale must be explained, not retried")

      MockCloud.routes["POST securetoken.googleapis.com/v1/token"] = (400, #"{"error":{"message":"TOKEN_EXPIRED"}}"#)
      await PlannerWidgetCloud.coordinator.use(URLSession(configuration: configuration))
      await PlannerWidgetCloud.refresh(force: true)
      check(PlannerWidgetKeychain.load() == nil, "A revoked session must remove the widget credential")
      PlannerWidgetKeychain.testCredential = nil

      let variants: [(String, WidgetFamily, CGFloat, CGFloat)] = [
        ("DueToday", .systemSmall, 170, 170), ("DueToday", .systemMedium, 364, 170),
        ("DueToday", .systemLarge, 364, 382), ("UpNext", .systemSmall, 170, 170),
        ("UpNext", .systemMedium, 364, 170), ("UpNext", .systemLarge, 364, 382),
        ("ThisWeek", .systemMedium, 364, 170), ("ThisWeek", .systemLarge, 364, 382),
        ("Progress", .systemSmall, 170, 170), ("Progress", .systemMedium, 364, 170),
        ("DueToday", .systemExtraLarge, 720, 382),
        ("Overdue", .systemSmall, 170, 170),
        ("Overdue", .systemMedium, 364, 170),
        ("Overdue", .systemLarge, 364, 382),
        ("HighPriority", .systemSmall, 170, 170),
        ("HighPriority", .systemMedium, 364, 170),
        ("HighPriority", .systemLarge, 364, 382),
        ("Tomorrow", .systemSmall, 170, 170),
        ("Tomorrow", .systemMedium, 364, 170),
        ("Tomorrow", .systemLarge, 364, 382),
        ("Unscheduled", .systemSmall, 170, 170),
        ("Unscheduled", .systemMedium, 364, 170),
        ("Unscheduled", .systemLarge, 364, 382),
        ("Reminders", .systemSmall, 170, 170),
        ("Reminders", .systemMedium, 364, 170),
        ("Reminders", .systemLarge, 364, 382),
        ("QuickCapture", .systemSmall, 170, 170),
        ("QuickCapture", .systemMedium, 364, 170),
      ]
      for mode in ["light", "dark", "pending", "private", "empty", "large-text", "interactive"] {
        var state = sample
        state.snapshot!.cloudUpdatedAt = now.timeIntervalSince1970 * 1000
        state.snapshot!.items += [tomorrowItem, undatedItem, overdueItem]
        if mode == "pending" {
          state.commands = [PlannerWidgetCommand(id: "pending", owner: "preview", kind: first.kind,
            recordId: first.id, revision: first.revision, date: first.date, time: first.time,
            createdAt: now.timeIntervalSince1970 * 1000)]
        }
        if mode == "private" { state.snapshot!.titlesAllowed = false; for index in state.snapshot!.items.indices { state.snapshot!.items[index].title = "" } }
        if mode == "empty" { state.snapshot!.items = [] }
        for (kind, family, width, height) in variants {
          let entry = PlannerEntry(date: now, state: state, options: PlannerWidgetOptions(), preview: mode != "interactive")
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
      try "\(checks) native checks passed; 196 native layout renders completed.\n".write(to: directory.appendingPathComponent("result.txt"), atomically: true, encoding: .utf8)
    } catch { fatalError("Widget validation failed: \(error)") }
  }
}
