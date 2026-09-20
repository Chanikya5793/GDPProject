const { withAppDelegate, withInfoPlist } = require('@expo/config-plugins');

// iOS 27 refuses to launch an app that has not adopted the UIScene lifecycle:
// UIKit traps in _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption
// during scene creation. The SDK 57 template still starts React Native from
// the AppDelegate with no scene, so this plugin adopts the lifecycle.
//
// It hands the scene to Expo's own `ExpoAppSceneDelegate`, which creates the
// window, starts React Native into it and -- the part the first version of
// this plugin missed -- re-feeds URLs, user activities, quick actions and
// life-cycle events to React Native and the app delegate. Under the scene
// lifecycle UIKit delivers those to the scene delegate only; with a delegate
// that merely attached the window, a widget tap or Siri phrase opened the app
// and went no further, because `Linking` never heard about the URL. Cold-start
// URLs are rebuilt into launch options so `Linking.getInitialURL()` sees them.
//
// `ExpoAppSceneDelegate` requires the AppDelegate to conform to
// `ExpoReactNativeFactoryProvider` and to leave window creation to the scene,
// so the template's `startReactNative` call in didFinishLaunching is removed.
//
// Lives as a config plugin rather than an edit under ios/, because ios/ is
// generated and gitignored — `expo prebuild` would silently discard it.

const MARKER = 'class SceneDelegate';

const SCENE_DELEGATE = `
// MARK: - UIScene lifecycle (added by plugins/withUISceneLifecycle.js)
// Expo's scene delegate creates the window, starts React Native into it and
// forwards URLs, user activities and life-cycle events. See the plugin.
class SceneDelegate: ExpoAppSceneDelegate {}
`;

const CLASS_LINE = 'class AppDelegate: ExpoAppDelegate {';
const CLASS_LINE_CONFORMING = 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {';

// The template's window creation. Kept as an exact match so a template change
// fails the build here, where it is obvious, rather than starting React
// Native twice at runtime.
const TEMPLATE_START = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
`;
const SCENE_START = `    // The window is created, and React Native started into it, by the scene
    // delegate (plugins/withUISceneLifecycle.js); starting it here as well
    // would render into a window the scene never shows.
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
    let contents = cfg.modResults.contents;
    if (contents.includes(MARKER)) {
      cfg.modResults.contents = contents;
      return cfg;
    }
    if (!contents.includes(CLASS_LINE)) {
      throw new Error('withUISceneLifecycle: AppDelegate no longer declares `class AppDelegate: ExpoAppDelegate`');
    }
    if (!contents.includes(TEMPLATE_START)) {
      throw new Error('withUISceneLifecycle: the template\'s startReactNative block changed; update the plugin');
    }
    contents = contents
      .replace(CLASS_LINE, CLASS_LINE_CONFORMING)
      .replace(TEMPLATE_START, SCENE_START);
    // Appending to AppDelegate.swift keeps the class in a file the Xcode project
    // already compiles; a new file would also need a pbxproj entry.
    cfg.modResults.contents = `${contents.trimEnd()}\n${SCENE_DELEGATE}`;
    return cfg;
  });

module.exports = config => withSceneDelegate(withSceneManifest(config));
