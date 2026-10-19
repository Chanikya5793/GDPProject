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
      let changed = try PlannerWidgetStore.publish(snapshot)
      removeLegacySnapshots()
      if changed { WidgetCenter.shared.reloadAllTimelines() }
      resolve(nil)
    } catch { reject("widget_publish", "Couldn't update widgets", error) }
  }

  @objc func claim(_ owner: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    do {
      let now = Date()
      let commands = try PlannerWidgetStore.transact { state -> [PlannerWidgetCommand] in
        guard state.snapshot?.owner == owner else { return [] }
        // One the extension is sending right now is its to finish; taking it
        // too would write the same completion twice and look like a conflict.
        for index in state.commands.indices where !state.commands[index].sending(at: now) {
          state.commands[index].claimed = true
        }
        return state.commands.filter(\.claimed)
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

  /// What the extension needs to reach the account while the app is closed.
  /// Rewritten whenever Firebase rotates the session.
  @objc func setCloudCredential(_ json: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    do {
      var credential = try JSONDecoder().decode(PlannerWidgetCredential.self, from: Data(json.utf8))
      // The app's own id, which an iOS-restricted API key is checked against.
      credential.bundleId = Bundle.main.bundleIdentifier ?? credential.bundleId
      try PlannerWidgetKeychain.save(credential)
      resolve(nil)
    } catch { reject("widget_credential", "Couldn't connect widgets to your account", error) }
  }

  /// The token this phone's widgets registered for push, so sign-out can
  /// unregister it before the credential goes.
  @objc func pushToken(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    resolve(PlannerWidgetStore.read().pushToken)
  }

  @objc func clear(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    do {
      PlannerWidgetKeychain.clear()
      try PlannerWidgetStore.transact { state in
        // The token belongs to this phone's widgets, not to the account.
        let push = state.pushToken
        state = PlannerWidgetState()
        state.pushToken = push
      }
      // Remove snapshots left by earlier app versions, including opted-in titles.
      removeLegacySnapshots()
      WidgetCenter.shared.reloadAllTimelines()
      resolve(nil)
    } catch { reject("widget_clear", "Couldn't clear widgets", error) }
  }
}
