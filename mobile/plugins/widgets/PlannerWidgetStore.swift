import Foundation
import Darwin
import Security

// Shared by the app and extension. One locked, atomically replaced document
// makes a tap durable without sharing the encrypted planner or its key.
struct PlannerWidgetItem: Codable, Identifiable, Equatable {
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

  /// One shared calendar. Building a Gregorian calendar per call made every
  /// sort comparison allocate; the time zone still follows the device.
  static let gregorian: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .autoupdatingCurrent
    return calendar
  }()

  /// yyyy-MM-dd in the device's zone, without a DateFormatter per call.
  static func dateKey(_ date: Date) -> String {
    let parts = gregorian.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
  }

  func scheduled(calendar: Calendar = PlannerWidgetItem.gregorian) -> Date? {
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

struct PlannerWidgetSnapshot: Codable, Equatable {
  var schema: Int = 1
  var owner: String
  var updatedAt: Double
  var cloudUpdatedAt: Double? = nil
  var cloudError: Bool? = nil
  var conflictCount: Int? = nil
  var titlesAllowed: Bool
  var items: [PlannerWidgetItem]
}

struct PlannerWidgetCommand: Codable, Identifiable, Equatable {
  var id: String
  var owner: String
  var kind: String
  var recordId: String
  var revision: Int?
  var date: String
  var time: String
  var createdAt: Double
  var claimed: Bool = false
  /// Set while the extension is sending this completion itself. The app
  /// leaves such a command alone for a while so the two never both write it.
  var sendingAt: Double? = nil
  var key: String { "\(kind):\(recordId)" }

  func sending(at now: Date) -> Bool {
    guard let sendingAt else { return false }
    return now.timeIntervalSince1970 * 1000 - sendingAt < 30_000
  }
}

struct PlannerWidgetState: Codable, Equatable {
  var snapshot: PlannerWidgetSnapshot?
  var commands: [PlannerWidgetCommand] = []
  var selections: [String: String] = [:]
  var notice: String? = nil
  var publishedBuild: String? = nil
  /// The extension's own reads of the account (PlannerWidgetCloud).
  var cloudMarker: Int? = nil
  var cloudCheckedAt: Double? = nil
  /// WidgetKit push token (iOS 26+), hex, and whether the account knows it.
  var pushToken: String? = nil
  var pushRegistered: String? = nil

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

  private static func directory() throws -> URL {
#if WIDGET_TESTS
    let container = testDirectory
#else
    let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
#endif
    guard let directory = container else { throw CocoaError(.fileNoSuchFile) }
    return directory
  }

  private static func locked<T>(_ operation: Int32, _ body: (URL) throws -> T) throws -> T {
    let directory = try directory()
    let lock = directory.appendingPathComponent("planner-widgets.lock")
    let descriptor = open(lock.path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else { throw CocoaError(.fileWriteUnknown) }
    defer { close(descriptor) }
    guard flock(descriptor, operation) == 0 else { throw CocoaError(.fileLocking) }
    defer { flock(descriptor, LOCK_UN) }
    return try body(directory.appendingPathComponent("planner-widgets-v1.json"))
  }

  private static func load(_ url: URL) throws -> PlannerWidgetState {
    guard FileManager.default.fileExists(atPath: url.path) else { return PlannerWidgetState() }
    return try JSONDecoder().decode(PlannerWidgetState.self, from: Data(contentsOf: url))
  }

  static func transact<T>(_ body: (inout PlannerWidgetState) throws -> T) throws -> T {
    try locked(LOCK_EX) { url in
      let original = try load(url)
      var state = original
      let result = try body(&state)
      if state != original {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(state).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var resource = url
        try resource.setResourceValues(values)
      }
      return result
    }
  }

  /// Readers share the lock: ten widget kinds reloading together no longer
  /// queue behind each other, and nothing is re-encoded just to look.
  static func read() -> PlannerWidgetState { (try? locked(LOCK_SH) { try load($0) }) ?? PlannerWidgetState() }

  static func publish(_ snapshot: PlannerWidgetSnapshot, build: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown") throws -> Bool {
    try transact { state -> Bool in
      let previous = state.snapshot
      // Wall-clock publication is not evidence of a cloud refresh. Identical
      // records should not spend another WidgetKit timeline reload.
      let changed = state.publishedBuild != build || previous?.owner != snapshot.owner || previous?.titlesAllowed != snapshot.titlesAllowed ||
        previous?.items != snapshot.items || previous?.cloudError != snapshot.cloudError ||
        previous?.conflictCount != snapshot.conflictCount ||
        (previous?.cloudUpdatedAt == nil) != (snapshot.cloudUpdatedAt == nil) ||
        (snapshot.cloudUpdatedAt ?? 0) - (previous?.cloudUpdatedAt ?? 0) >= 3_600_000
      if previous?.owner != snapshot.owner {
        let push = state.pushToken
        state = PlannerWidgetState()
        state.pushToken = push
      }
      state.snapshot = snapshot
      state.publishedBuild = build
      return changed
    }
  }

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
      // Keys end in the day they were made for; yesterday's pages are noise.
      if state.selections.count > 60 {
        let today = PlannerWidgetItem.dateKey(Date())
        state.selections = state.selections.filter { $0.key.contains(today) }
      }
      state.selections[key] = value
    }
  }
}

/// What the widget extension needs to read and complete records on its own
/// while the app is closed. Written by the app (PlannerWidgetsBridge) into
/// the keychain under the App Group, which both targets already share, so no
/// new entitlement is involved. The refresh token is a long-lived credential
/// for the account: it lives only in the keychain, this device only, and is
/// deleted with everything else on sign-out.
struct PlannerWidgetCredential: Codable, Equatable {
  var uid: String
  var owner: String
  var refreshToken: String
  var apiKey: String
  var projectId: String
  var database: String
  var apiUrl: String
  var bundleId: String
}

enum PlannerWidgetKeychain {
  private static let service = "com.nwmissouri.studentplanner.widget-cloud"
  private static var query: [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: "credential",
    ]
#if !WIDGET_TESTS
    query[kSecAttrAccessGroup as String] = PlannerWidgetStore.group
#endif
    return query
  }

#if WIDGET_TESTS
  // The validation harness is unsigned and has no keychain entitlement.
  static var testCredential: PlannerWidgetCredential?
  static func load() -> PlannerWidgetCredential? { testCredential }
  static func save(_ credential: PlannerWidgetCredential) throws { testCredential = credential }
  static func clear() { testCredential = nil }
#else
  static func load() -> PlannerWidgetCredential? {
    var request = query
    request[kSecReturnData as String] = true
    request[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: AnyObject?
    guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
    return try? JSONDecoder().decode(PlannerWidgetCredential.self, from: data)
  }

  static func save(_ credential: PlannerWidgetCredential) throws {
    if load() == credential { return }
    let data = try JSONEncoder().encode(credential)
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      // Timelines reload on a locked phone; never leaves this device.
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      status = SecItemAdd(query.merging(attributes) { $1 } as CFDictionary, nil)
    }
    guard status == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
  }

  static func clear() { SecItemDelete(query as CFDictionary) }
#endif
}
