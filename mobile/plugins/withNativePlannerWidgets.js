const fs = require('fs');
const path = require('path');
const { IOSConfig, withXcodeProject } = require('@expo/config-plugins');
const plist = require('@expo/plist').default;

const source = name => fs.readFileSync(path.join(__dirname, 'widgets', name), 'utf8');

// Run after expo-widgets. Keep its target, entitlements, configuration intent
// identities and Live Activity, but render planner widgets in native SwiftUI.
// Source lives here so clean prebuilds reproduce the complete implementation.
// WidgetKit push needs `.pushHandler` (iOS 26) on each configuration, and a
// result builder cannot pick between an iOS 26 and an older configuration
// with else. So every kind gets an iOS 26 twin, and the bundle lists either.
const pushVariant = name => `
@available(iOS 26.0, *)
struct ${name}Push: Widget {
  var body: some WidgetConfiguration { ${name}().body.pushHandler(PlannerWidgetPushHandler.self) }
}
`;

function rewriteBundle(file, names) {
  let bundle = fs.readFileSync(file, 'utf8');
  for (const name of names) {
    const gated = new RegExp(`if #available\\(iOS 17\\.0, \\*\\) \\{\\s*${name}\\(\\)\\s*\\}`);
    const plain = new RegExp(`^(\\s*)${name}\\(\\)$`, 'm');
    if (gated.test(bundle)) {
      bundle = bundle.replace(gated, `if #available(iOS 26.0, *) { ${name}Push() }\n    if #available(iOS 17.0, *), !PlannerWidgetPushSupport.available { ${name}() }`);
    } else if (plain.test(bundle)) {
      bundle = bundle.replace(plain, `$1if #available(iOS 26.0, *) { ${name}Push() }\n$1if #available(iOS 16.0, *), !PlannerWidgetPushSupport.available { ${name}() }`);
    } else {
      throw new Error(`expo-widgets bundle changed: ${name} not found in index.swift`);
    }
  }
  fs.writeFileSync(file, bundle);
}

module.exports = config => {
  const plugin = config.plugins.find(value => Array.isArray(value) && value[0] === 'expo-widgets');
  if (!plugin) throw new Error('withNativePlannerWidgets must follow expo-widgets');
  const widgets = plugin[1].widgets;
  for (const name of ['PlannerWidgetStore.swift', 'PlannerWidgetCloud.swift', 'PlannerWidgetIntents.swift', 'PlannerWidgetsBridge.swift', 'PlannerWidgetsBridge.m']) {
    config = IOSConfig.XcodeProjectFile.withBuildSourceFile(config, {
      filePath: name, contents: source(name), overwrite: true,
    });
  }
  return withXcodeProject(config, result => {
    const directory = path.join(result.modRequest.platformProjectRoot, 'ExpoWidgetsTarget');
    for (const widget of widgets) {
      const ios = widget.ios;
      const file = path.join(directory, `${widget.name}.swift`);
      const generated = fs.readFileSync(file, 'utf8');
      let output;
      if (ios.configuration) {
        const marker = `struct ${widget.name}TimelineEntry: TimelineEntry`;
        if (!generated.includes(marker)) throw new Error(`expo-widgets generator changed for ${widget.name}`);
        const bindings = Object.entries(ios.configuration.parameters).map(([key, parameter]) => {
          const field = key === 'density' ? 'compact' : key;
          const value = key === 'density' ? 'configuration.density.rawValue == "compact"'
            : `configuration.${key}${parameter.type === 'enum' ? '.rawValue' : ''}`;
          return `    options.${field} = ${value}`;
        }).join('\n');
        output = `${generated.split(marker)[0]}
@available(iOS 17.0, *)
struct ${widget.name}NativeProvider: AppIntentTimelineProvider {
  func options(_ configuration: ${widget.name}ConfigurationAppIntent) -> PlannerWidgetOptions {
    var options = PlannerWidgetOptions()
${bindings}
    return options
  }
  func placeholder(in context: Context) -> PlannerEntry {
    PlannerWidgetTimeline.entries(options: PlannerWidgetOptions(), preview: true)[0]
  }
  func snapshot(for configuration: ${widget.name}ConfigurationAppIntent, in context: Context) async -> PlannerEntry {
    PlannerWidgetTimeline.entries(options: options(configuration), preview: context.isPreview)[0]
  }
  func timeline(for configuration: ${widget.name}ConfigurationAppIntent, in context: Context) async -> Timeline<PlannerEntry> {
    await PlannerWidgetCloud.refresh()
    return Timeline(entries: PlannerWidgetTimeline.entries(options: options(configuration)), policy: .atEnd)
  }
}

@available(iOS 17.0, *)
struct ${widget.name}: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: "${widget.name}", intent: ${widget.name}ConfigurationAppIntent.self, provider: ${widget.name}NativeProvider()) { entry in
      PlannerWidgetView(entry: entry, kind: "${widget.name}")
    }
    .configurationDisplayName(${JSON.stringify(widget.displayName)})
    .description(${JSON.stringify(widget.description)})
    .supportedFamilies([${ios.supportedFamilies.map(family => `.${family}`).join(', ')}])
  }
}
${pushVariant(widget.name)}`;
      } else {
        output = `import WidgetKit
import SwiftUI
struct ${widget.name}: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "${widget.name}", provider: PlannerProgressProvider()) { entry in
      PlannerWidgetView(entry: entry, kind: "${widget.name}")
    }
    .configurationDisplayName(${JSON.stringify(widget.displayName)})
    .description(${JSON.stringify(widget.description)})
    .supportedFamilies([${ios.supportedFamilies.map(family => `.${family}`).join(', ')}])
  }
}
${pushVariant(widget.name)}`;
      }
      if (widget.name === 'DueToday') {
        output += '\n' + ['PlannerWidgetStore.swift', 'PlannerWidgetCloud.swift', 'PlannerWidgetIntents.swift', 'PlannerWidgetViews.swift']
          .map(source).join('\n');
      }
      fs.writeFileSync(file, output);
    }
    rewriteBundle(path.join(directory, 'index.swift'), widgets.map(widget => widget.name));
    // WidgetKit push needs the APNs entitlement on the extension only; the
    // app itself still schedules everything locally (withoutPushEntitlement).
    // Xcode's export swaps in "production" for App Store signing.
    const entitlements = path.join(directory, 'ExpoWidgetsTarget.entitlements');
    const values = plist.parse(fs.readFileSync(entitlements, 'utf8'));
    values['aps-environment'] = values['aps-environment'] || 'development';
    fs.writeFileSync(entitlements, plist.build(values));
    return result;
  });
};
