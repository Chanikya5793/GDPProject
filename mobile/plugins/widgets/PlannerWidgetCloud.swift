import Foundation
import WidgetKit

// The widget extension's own path to the account, so a widget stays current
// and a tick reaches other devices while the app is closed. Compiled into
// both targets (the completion intent references it); only the extension
// calls it.
//
// Reads cost one Firestore document (the content-free change marker,
// users/{uid}/meta/sync) per check; the two lists are fetched only when the
// marker moved since the extension last looked. Everything is advisory: any
// failure leaves the last snapshot and the app's own sync exactly as before.
enum PlannerWidgetCloud {
  static let coordinator = PlannerWidgetCloudCoordinator()
  /// Ten widget kinds reload together; one check serves them all. Short,
  /// because a push-triggered reload must not be skipped as "just checked".
  /// Shorter than the backend's 10 s push spacing, so a push always lands
  /// after the window.
  static let minimumInterval: TimeInterval = 3
  static let clientId = "widget-\(UUID().uuidString.prefix(8).lowercased())"

  static func refresh(force: Bool = false) async {
    await coordinator.refresh(force: force)
  }

  /// Send a completion the extension just recorded. Returns once the command
  /// is resolved or left for the app (offline, or this build's backend is
  /// older than the endpoint).
  static func complete(commandId: String) async {
    await coordinator.complete(commandId: commandId)
  }
}

struct PlannerWidgetHTTPError: Error {
  let status: Int
  /// The refresh token itself was refused: revoked, or the account is gone.
  var revoked = false
}

actor PlannerWidgetCloudCoordinator {
  private var inflight: Task<Void, Never>?
  private var idToken: (value: String, expires: Date, uid: String)?
  var session = URLSession(configuration: {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 6
    configuration.timeoutIntervalForResource = 8
    configuration.waitsForConnectivity = false
    return configuration
  }())

#if WIDGET_TESTS
  func use(_ session: URLSession) { self.session = session; idToken = nil }
#endif

  func refresh(force: Bool) async {
    if let inflight {
      await inflight.value
      // A forced check (a push, a stale completion) must not settle for a
      // throttled one that happened to be running.
      if !force { return }
    }
    let task = Task { await self.run(force: force) }
    inflight = task
    await task.value
    inflight = nil
  }

  private func run(force: Bool) async {
    guard let credential = PlannerWidgetKeychain.load() else { return }
    let state = PlannerWidgetStore.read()
    guard let snapshot = state.snapshot, snapshot.owner == credential.owner else { return }
    let now = Date()
    if !force, let checked = state.cloudCheckedAt,
       now.timeIntervalSince1970 * 1000 - checked < PlannerWidgetCloud.minimumInterval * 1000 { return }
    do {
      try? await registerPushToken(credential)
      // Unreadable (rules not deployed yet, say): fall back to a full read at
      // most every 15 minutes rather than on every reload.
      let marker = try? await readMarker(credential)
      let lastRead = (snapshot.cloudUpdatedAt ?? 0) / 1000
      let unchanged = marker.map { $0 == state.cloudMarker }
        ?? (!force && now.timeIntervalSince1970 - lastRead < 15 * 60)
      if unchanged {
        try PlannerWidgetStore.transact { state in
          guard state.snapshot?.owner == credential.owner else { return }
          state.cloudCheckedAt = now.timeIntervalSince1970 * 1000
          if marker != nil {
            state.snapshot?.cloudUpdatedAt = now.timeIntervalSince1970 * 1000
            state.snapshot?.cloudError = false
          }
        }
        return
      }
      async let tasks = records("task", credential)
      async let reminders = records("reminder", credential)
      let fetched = try await tasks + reminders
      let changed = try PlannerWidgetStore.transact { state -> Bool in
        guard var current = state.snapshot, current.owner == credential.owner else { return false }
        let before = current.items
        let merged = PlannerWidgetRecords.merge(fetched, into: before, titlesAllowed: current.titlesAllowed)
        current.items = merged.items
        current.cloudUpdatedAt = now.timeIntervalSince1970 * 1000
        current.cloudError = false
        state.snapshot = current
        // If a completion landed while these lists were in flight, the lists
        // predate the marker; look again next time rather than trust it.
        state.cloudMarker = merged.overtaken ? nil : marker
        state.cloudCheckedAt = now.timeIntervalSince1970 * 1000
        return current.items != before
      }
      // Other placed widgets read the same store; the one being reloaded
      // already sees this. The interval check above stops them fetching again.
      if changed { WidgetCenter.shared.reloadAllTimelines() }
    } catch let error as PlannerWidgetHTTPError where error.revoked {
      // Revoked or signed out elsewhere: stop until the app writes a fresh one.
      idToken = nil
      PlannerWidgetKeychain.clear()
    } catch {
      _ = try? PlannerWidgetStore.transact { state in
        state.cloudCheckedAt = now.timeIntervalSince1970 * 1000
      }
    }
  }

  func complete(commandId: String) async {
    guard let credential = PlannerWidgetKeychain.load() else { return }
    let now = Date()
    guard let command = try? PlannerWidgetStore.transact({ state -> PlannerWidgetCommand? in
      guard state.snapshot?.owner == credential.owner,
            let index = state.commands.firstIndex(where: { $0.id == commandId && !$0.claimed }) else { return nil }
      state.commands[index].sendingAt = now.timeIntervalSince1970 * 1000
      return state.commands[index]
    }) else { return }
    let kind = command.kind == "reminder" ? "reminder" : "task"
    var body: [String: Any] = ["idempotency_key": command.id]
    if let revision = command.revision { body["expected_revision"] = revision }
    do {
      let data = try await request(credential, path: "/v1/records/\(kind)/\(escape(command.recordId))/complete",
                                   method: "POST", body: body)
      let saved = try JSONDecoder().decode(PlannerWidgetServerRecord.self, from: data)
      try PlannerWidgetStore.transact { state in
        state.commands.removeAll { $0.id == command.id }
        guard var snapshot = state.snapshot, snapshot.owner == credential.owner else { return }
        if let index = snapshot.items.firstIndex(where: { $0.key == command.key }) {
          snapshot.items[index].done = true
          snapshot.items[index].revision = saved.revision
          snapshot.items[index].pending = false
        }
        state.snapshot = snapshot
      }
    } catch let error as PlannerWidgetHTTPError where error.status == 409 {
      try? PlannerWidgetStore.transact { state in
        state.commands.removeAll { $0.id == command.id }
        state.notice = "This item changed on another device. Open planner to review."
      }
      await refresh(force: true)
    } catch {
      // Offline, a cold service, or an older backend: release it to the app's
      // encrypted outbox, which replays it on the next launch.
      try? PlannerWidgetStore.transact { state in
        if let index = state.commands.firstIndex(where: { $0.id == command.id }) {
          state.commands[index].sendingAt = nil
        }
      }
    }
  }

  // MARK: - Transport

  private func token(_ credential: PlannerWidgetCredential) async throws -> String {
    if let idToken, idToken.uid == credential.uid, idToken.expires > Date().addingTimeInterval(120) { return idToken.value }
    var components = URLComponents(string: "https://securetoken.googleapis.com/v1/token")!
    components.queryItems = [URLQueryItem(name: "key", value: credential.apiKey)]
    var request = URLRequest(url: components.url!)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.setValue(credential.bundleId, forHTTPHeaderField: "X-Ios-Bundle-Identifier")
    var form = URLComponents()
    form.queryItems = [URLQueryItem(name: "grant_type", value: "refresh_token"),
                       URLQueryItem(name: "refresh_token", value: credential.refreshToken)]
    request.httpBody = form.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B").data(using: .utf8)
    let (data, response) = try await session.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard status == 200 else { throw PlannerWidgetHTTPError(status: status, revoked: status == 400) }
    let exchanged = try JSONDecoder().decode(PlannerWidgetTokenResponse.self, from: data)
    // A token for some other account must never be used for this one.
    guard exchanged.user_id == credential.uid else { throw PlannerWidgetHTTPError(status: 400, revoked: true) }
    let lifetime = TimeInterval(exchanged.expires_in) ?? 3600
    idToken = (exchanged.id_token, Date().addingTimeInterval(lifetime), credential.uid)
    // Only over the credential this exchange started from: the app may have
    // written another account's meanwhile.
    if exchanged.refresh_token != credential.refreshToken, !exchanged.refresh_token.isEmpty,
       PlannerWidgetKeychain.load() == credential {
      var rotated = credential
      rotated.refreshToken = exchanged.refresh_token
      try? PlannerWidgetKeychain.save(rotated)
    }
    return exchanged.id_token
  }

  private func readMarker(_ credential: PlannerWidgetCredential) async throws -> Int {
    let path = "projects/\(credential.projectId)/databases/\(credential.database)/documents/users/\(escape(credential.uid))/meta/sync"
    var request = URLRequest(url: URL(string: "https://firestore.googleapis.com/v1/\(path)")!)
    request.setValue("Bearer \(try await token(credential))", forHTTPHeaderField: "Authorization")
    request.setValue(credential.bundleId, forHTTPHeaderField: "X-Ios-Bundle-Identifier")
    let (data, response) = try await session.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    if status == 404 { return 0 }
    guard status == 200 else { throw PlannerWidgetHTTPError(status: status) }
    let document = try JSONDecoder().decode(PlannerWidgetMarkerDocument.self, from: data)
    return Int(document.fields?.version?.integerValue ?? "0") ?? 0
  }

  private func records(_ kind: String, _ credential: PlannerWidgetCredential) async throws -> [PlannerWidgetServerRecord] {
    let data = try await request(credential, path: "/v1/records/\(kind)", method: "GET", body: nil)
    return try JSONDecoder().decode([PlannerWidgetServerRecord].self, from: data)
  }

  private func registerPushToken(_ credential: PlannerWidgetCredential) async throws {
    let state = PlannerWidgetStore.read()
    guard let token = state.pushToken, state.pushRegistered != "\(credential.uid):\(token)" else { return }
#if DEBUG
    let environment = "development"
#else
    let environment = "production"
#endif
    _ = try await request(credential, path: "/v1/devices/widget-push", method: "POST",
                          body: ["token": token, "environment": environment])
    try PlannerWidgetStore.transact { $0.pushRegistered = "\(credential.uid):\(token)" }
  }

  private func request(_ credential: PlannerWidgetCredential, path: String, method: String, body: [String: Any]?) async throws -> Data {
    guard let url = URL(string: credential.apiUrl + path) else { throw PlannerWidgetHTTPError(status: 0) }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue("Bearer \(try await token(credential))", forHTTPHeaderField: "Authorization")
    request.setValue(PlannerWidgetCloud.clientId, forHTTPHeaderField: "X-Planner-Client")
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try JSONSerialization.data(withJSONObject: body)
    }
    let (data, response) = try await session.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else { throw PlannerWidgetHTTPError(status: status) }
    return data
  }

  private func escape(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? value
  }
}

struct PlannerWidgetTokenResponse: Decodable {
  var id_token: String
  var expires_in: String
  var user_id: String
  var refresh_token: String
}

struct PlannerWidgetMarkerDocument: Decodable {
  struct Fields: Decodable { var version: Value? }
  struct Value: Decodable { var integerValue: String? }
  var fields: Fields?
}

struct PlannerWidgetServerRecord: Decodable {
  struct Content: Decodable {
    var entity_type: String
    var title: String
    var due_date: String?
    var due_time: String?
    var date: String?
    var time: String?
    var priority: String?
    var category: String?
    var completed: Bool?
  }
  var record_id: String
  var revision: Int
  var content: Content
}

/// The Swift twin of utils/widgetSnapshot.ts: the same minimized fields,
/// the same title consent, the same rejection of malformed dates.
enum PlannerWidgetRecords {
  static let maxTitleLength = 100

  static func item(_ record: PlannerWidgetServerRecord, titlesAllowed: Bool) -> PlannerWidgetItem? {
    let content = record.content
    guard content.entity_type == "task" || content.entity_type == "reminder" else { return nil }
    let isTask = content.entity_type == "task"
    let date = (isTask ? content.due_date : content.date) ?? ""
    let time = (isTask ? content.due_time : content.time) ?? ""
    if !time.isEmpty, time.range(of: #"^([01]?\d|2[0-3]):[0-5]\d$"#, options: .regularExpression) == nil { return nil }
    // The app's ids are numbers when they look like numbers.
    let id = record.record_id.allSatisfy(\.isNumber) ? Int(record.record_id).map(String.init) ?? record.record_id : record.record_id
    var item = PlannerWidgetItem(id: id, kind: content.entity_type, title: "", date: date, time: time,
      category: titlesAllowed && isTask ? String((content.category ?? "").prefix(40)) : "",
      priority: isTask ? content.priority ?? "medium" : "", done: content.completed ?? false,
      revision: record.revision, pending: false)
    if !date.isEmpty, item.scheduled() == nil { return nil }
    if titlesAllowed {
      let title = content.title.trimmingCharacters(in: .whitespacesAndNewlines)
      item.title = title.count > maxTitleLength ? String(title.prefix(maxTitleLength - 1)) + "…" : title
    }
    return item
  }

  /// Server records replace the snapshot's, except where this phone is
  /// ahead: changes not yet on the account (pending), and records already
  /// at a newer revision than this fetch (a completion that landed while the
  /// lists were in flight).
  static func merge(_ records: [PlannerWidgetServerRecord], into current: [PlannerWidgetItem],
                    titlesAllowed: Bool) -> (items: [PlannerWidgetItem], overtaken: Bool) {
    let local = Dictionary(current.map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first })
    var overtaken = false
    let fresh = records.compactMap { item($0, titlesAllowed: titlesAllowed) }.map { item -> PlannerWidgetItem in
      guard let mine = local[item.key] else { return item }
      if mine.pending { return mine }
      if (mine.revision ?? 0) > (item.revision ?? 0) { overtaken = true; return mine }
      return item
    }
    let seen = Set(fresh.map(\.key))
    return (fresh + current.filter { $0.pending && !seen.contains($0.key) }, overtaken)
  }
}
