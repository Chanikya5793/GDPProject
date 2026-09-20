import Foundation
import WidgetKit
import React

@objc(PlannerWidgetsBridge)
final class PlannerWidgetsBridge: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  private func removeLegacySnapshots() {
    let defaults = UserDefaults(suiteName: PlannerWidgetStore.group)
    for kind in ["DueToday", "UpNext", "ThisWeek", "Progress"] {
      defaults?.removeObject(forKey: "__expo_widgets_\(kind)_timeline")
      defaults?.removeObject(forKey: "__expo_widgets_\(kind)_layout")
    }
  }

  @objc func pendingCount(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(PlannerWidgetStore.read().commands.count)
  }

  @objc func publish(_ json: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    do {
      let snapshot = try JSONDecoder().decode(PlannerWidgetSnapshot.self, from: Data(json.utf8))
      try PlannerWidgetStore.transact { state in
        if state.snapshot?.owner != snapshot.owner { state = PlannerWidgetState() }
        state.snapshot = snapshot
      }
      removeLegacySnapshots()
      WidgetCenter.shared.reloadAllTimelines()
      resolve(nil)
    } catch { reject("widget_publish", "Couldn't update widgets", error) }
  }

  @objc func claim(_ owner: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    do {
      let commands = try PlannerWidgetStore.transact { state -> [PlannerWidgetCommand] in
        guard state.snapshot?.owner == owner else { return [] }
        for index in state.commands.indices { state.commands[index].claimed = true }
        return state.commands
      }
      resolve(String(data: try JSONEncoder().encode(commands), encoding: .utf8))
    } catch { reject("widget_claim", "Couldn't read widget changes", error) }
  }

  @objc func acknowledge(_ owner: String, commandId: String, notice: String,
      resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    do {
      try PlannerWidgetStore.transact { state in
        guard state.snapshot?.owner == owner else { return }
        state.commands.removeAll { $0.id == commandId }
        if !notice.isEmpty { state.notice = notice }
      }
      resolve(nil)
    } catch { reject("widget_acknowledge", "Couldn't save widget changes", error) }
  }

  @objc func clear(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    do {
      try PlannerWidgetStore.transact { $0 = PlannerWidgetState() }
      // Remove snapshots left by earlier app versions, including opted-in titles.
      removeLegacySnapshots()
      WidgetCenter.shared.reloadAllTimelines()
      resolve(nil)
    } catch { reject("widget_clear", "Couldn't clear widgets", error) }
  }
}
