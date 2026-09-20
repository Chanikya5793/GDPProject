import Foundation
import Darwin

// Shared by the app and extension. One locked, atomically replaced document
// makes a tap durable without sharing the encrypted planner or its key.
struct PlannerWidgetItem: Codable, Identifiable {
  var id: String
  var kind: String
  var title: String
  var date: String
  var time: String
  var category: String
  var priority: String
  var done: Bool
  var revision: Int?
  var pending: Bool
  var key: String { "\(kind):\(id)" }

  func scheduled(calendar: Calendar = Calendar(identifier: .gregorian)) -> Date? {
    let parts = date.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return nil }
    let clock = time.split(separator: ":").compactMap { Int($0) }
    let value = DateComponents(year: parts[0], month: parts[1], day: parts[2],
      hour: clock.count == 2 ? clock[0] : 23, minute: clock.count == 2 ? clock[1] : 59)
    guard let result = calendar.date(from: value) else { return nil }
    let check = calendar.dateComponents([.year, .month, .day], from: result)
    guard check.year == parts[0], check.month == parts[1], check.day == parts[2] else { return nil }
    return result
  }

  func isOverdue(at now: Date) -> Bool {
    guard !done, let at = scheduled() else { return false }
    if time.isEmpty { return Calendar.current.startOfDay(for: at) < Calendar.current.startOfDay(for: now) }
    return at < now
  }
}

struct PlannerWidgetSnapshot: Codable {
  var schema: Int = 1
  var owner: String
  var updatedAt: Double
  var titlesAllowed: Bool
  var items: [PlannerWidgetItem]
}

struct PlannerWidgetCommand: Codable, Identifiable {
  var id: String
  var owner: String
  var kind: String
  var recordId: String
  var revision: Int?
  var date: String
  var time: String
  var createdAt: Double
  var claimed: Bool = false
  var key: String { "\(kind):\(recordId)" }
}

struct PlannerWidgetState: Codable {
  var snapshot: PlannerWidgetSnapshot?
  var commands: [PlannerWidgetCommand] = []
  var selections: [String: String] = [:]
  var notice: String? = nil

  var items: [PlannerWidgetItem] {
    let pending = Set(commands.filter { $0.owner == snapshot?.owner }.map(\.key))
    return (snapshot?.items ?? []).map { record in
      var item = record
      if pending.contains(item.key) { item.done = true; item.pending = true }
      return item
    }
  }
}

enum PlannerWidgetStore {
  static let group = "group.com.nwmissouri.studentplanner"
#if WIDGET_TESTS
  static var testDirectory: URL?
#endif

  static func transact<T>(_ body: (inout PlannerWidgetState) throws -> T) throws -> T {
#if WIDGET_TESTS
    let container = testDirectory
#else
    let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
#endif
    guard let directory = container else {
      throw CocoaError(.fileNoSuchFile)
    }
    let lock = directory.appendingPathComponent("planner-widgets.lock")
    let descriptor = open(lock.path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else { throw CocoaError(.fileWriteUnknown) }
    defer { close(descriptor) }
    guard flock(descriptor, LOCK_EX) == 0 else { throw CocoaError(.fileLocking) }
    defer { flock(descriptor, LOCK_UN) }
    let url = directory.appendingPathComponent("planner-widgets-v1.json")
    var state = PlannerWidgetState()
    if FileManager.default.fileExists(atPath: url.path) {
      state = try JSONDecoder().decode(PlannerWidgetState.self, from: Data(contentsOf: url))
    }
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let before = try encoder.encode(state)
    let result = try body(&state)
    let after = try encoder.encode(state)
    if before != after {
      try after.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      var resource = url
      try resource.setResourceValues(values)
    }
    return result
  }

  static func read() -> PlannerWidgetState { (try? transact { $0 }) ?? PlannerWidgetState() }

  static func complete(owner: String, key: String, revision: Int?, date: String, time: String) throws {
    try transact { state in
      guard let snapshot = state.snapshot, snapshot.owner == owner,
            let item = snapshot.items.first(where: { $0.key == key }), !item.done,
            !state.commands.contains(where: { $0.key == key }) else { return }
      guard item.revision == revision, item.date == date, item.time == time else {
        state.notice = "This item changed. Open planner to review."
        return
      }
      guard state.commands.count < 500 else { throw CocoaError(.fileWriteOutOfSpace) }
      state.commands.append(PlannerWidgetCommand(id: UUID().uuidString, owner: owner,
        kind: item.kind, recordId: item.id, revision: item.revision, date: item.date,
        time: item.time, createdAt: Date().timeIntervalSince1970 * 1000))
      state.notice = nil
    }
  }

  static func undo(owner: String, commandId: String) throws {
    try transact { state in
      guard state.snapshot?.owner == owner else { return }
      state.commands.removeAll { $0.id == commandId && !$0.claimed }
    }
  }

  static func select(owner: String, key: String, value: String) throws {
    try transact { state in
      guard state.snapshot?.owner == owner else { return }
      if state.selections.count > 100 { state.selections.removeAll() }
      state.selections[key] = value
    }
  }
}
