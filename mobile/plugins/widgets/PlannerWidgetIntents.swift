import Foundation
import WidgetKit
import AppIntents

// Compile these actions into BOTH the app and widget extension. WidgetKit
// resolves the archived button action through the containing app registry.
@available(iOS 17.0, *)
struct CompletePlannerWidgetIntent: AppIntent {
  static var title: LocalizedStringResource = "Complete planner item"
  static var isDiscoverable = false
  // Runs in the extension: persisted locally first, then sent to the account
  // directly (PlannerWidgetCloud), falling back to the app's encrypted outbox.
  static var openAppWhenRun = false
  static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
  @Parameter(title: "Account") var owner: String
  @Parameter(title: "Item") var key: String
  @Parameter(title: "Revision") var revision: Int
  @Parameter(title: "Date") var date: String?
  @Parameter(title: "Time") var time: String?
  init() {}
  init(owner: String, item: PlannerWidgetItem) {
    self.owner = owner; self.key = item.key; self.revision = item.revision ?? -1
    self.date = item.date.isEmpty ? nil : item.date; self.time = item.time.isEmpty ? nil : item.time
  }
  func perform() async throws -> some IntentResult {
    try PlannerWidgetStore.complete(owner: owner, key: key, revision: revision < 0 ? nil : revision, date: date ?? "", time: time ?? "")
    // Every placed widget shows the tick straight away, from the store.
    WidgetCenter.shared.reloadAllTimelines()
    // Then send it to the account, so other devices see it without this
    // phone's app being opened. Unsent, it waits for the app's outbox.
    if let command = PlannerWidgetStore.read().commands.last(where: { $0.key == key && $0.owner == owner }) {
      await PlannerWidgetCloud.complete(commandId: command.id)
    }
    return .result()
  }
}

@available(iOS 17.0, *)
struct UndoPlannerWidgetIntent: AppIntent {
  static var title: LocalizedStringResource = "Undo widget completion"
  static var isDiscoverable = false
  static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
  @Parameter(title: "Account") var owner: String
  @Parameter(title: "Change") var commandId: String
  init() {}
  init(owner: String, commandId: String) { self.owner = owner; self.commandId = commandId }
  func perform() async throws -> some IntentResult {
    try PlannerWidgetStore.undo(owner: owner, commandId: commandId)
    WidgetCenter.shared.reloadAllTimelines()
    return .result()
  }
}

@available(iOS 17.0, *)
struct SelectPlannerWidgetIntent: AppIntent {
  static var title: LocalizedStringResource = "Browse planner widget"
  static var isDiscoverable = false
  @Parameter(title: "Account") var owner: String
  @Parameter(title: "Widget") var key: String
  @Parameter(title: "Selection") var value: String
  init() {}
  init(owner: String, key: String, value: String) { self.owner = owner; self.key = key; self.value = value }
  func perform() async throws -> some IntentResult {
    try PlannerWidgetStore.select(owner: owner, key: key, value: value)
    return .result()
  }
}


/// WidgetKit push (iOS 26+). The token is kept in the shared store and
/// registered with the account by the extension's next cloud check; a
/// push then reloads every planner widget, whose provider fetches the change.
@available(iOS 26.0, *)
struct PlannerWidgetPushHandler: WidgetPushHandler {
  init() {}
  func pushTokenDidChange(_ pushInfo: WidgetPushInfo, widgets: [WidgetInfo]) {
    let hex = pushInfo.token.map { String(format: "%02x", $0) }.joined()
    try? PlannerWidgetStore.transact { state in
      guard state.pushToken != hex else { return }
      state.pushToken = hex
      state.pushRegistered = nil
    }
    Task { await PlannerWidgetCloud.refresh(force: true) }
  }
}

enum PlannerWidgetPushSupport {
  static var available: Bool {
    if #available(iOS 26.0, *) { return true } else { return false }
  }
}
