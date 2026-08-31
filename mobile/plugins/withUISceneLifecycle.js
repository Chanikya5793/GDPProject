const { withAppDelegate, withInfoPlist } = require('@expo/config-plugins');

// iOS 27 refuses to launch an app that has not adopted the UIScene lifecycle:
// UIKit traps in _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption
// during scene creation. React Native 0.86 has no scene support of its own —
// UIWindowSceneDelegate appears nowhere in the dependency tree, and
// RCTAppDelegate still builds the window in didFinishLaunchingWithOptions.
//
// This plugin adopts the lifecycle without disturbing how React Native starts:
// the AppDelegate still creates the window and mounts React into it, and the
// scene delegate simply attaches that existing window to the incoming scene.
// Creating a second window here would leave React rendering into an orphan.
//
// Lives as a config plugin rather than an edit under ios/, because ios/ is
// generated and gitignored — `expo prebuild` would silently discard it.

const MARKER = 'class SceneDelegate';

const SCENE_DELEGATE = `
// MARK: - UIScene lifecycle (added by plugins/withUISceneLifecycle.js)
// Adopts the window the AppDelegate already started React Native into, rather
// than creating a second one. See the plugin for why this is needed.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    guard let existing = (UIApplication.shared.delegate as? AppDelegate)?.window else { return }
    existing.windowScene = windowScene
    window = existing
    existing.makeKeyAndVisible()
  }
}
`;

const withSceneManifest = config =>
  withInfoPlist(config, cfg => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            // Resolved against the app target's Swift module at runtime.
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return cfg;
  });

const withSceneDelegate = config =>
  withAppDelegate(config, cfg => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error(
        `withUISceneLifecycle expected a Swift AppDelegate, got ${cfg.modResults.language}`,
      );
    }
    // Appending to AppDelegate.swift keeps the class in a file the Xcode project
    // already compiles; a new file would also need a pbxproj entry.
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents = `${cfg.modResults.contents.trimEnd()}\n${SCENE_DELEGATE}`;
    }
    return cfg;
  });

module.exports = config => withSceneDelegate(withSceneManifest(config));
