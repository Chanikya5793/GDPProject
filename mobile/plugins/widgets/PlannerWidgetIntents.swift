import Foundation
import WidgetKit
import AppIntents

// Compile these actions into BOTH the app and widget extension. WidgetKit
// resolves the archived button action through the containing app registry.
@available(iOS 17.0, *)
struct CompletePlannerWidgetIntent: AppIntent {
  static var title: LocalizedStringResource = "Complete planner item"
  static var isDiscoverable = false
  // Persist locally in the extension. Foreground-only intents cannot run
  // here; cloud reconciliation happens through the app's encrypted outbox.
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
    WidgetCenter.shared.reloadAllTimelines()
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

