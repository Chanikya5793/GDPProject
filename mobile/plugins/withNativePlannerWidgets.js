const fs = require('fs');
const path = require('path');
const { IOSConfig, withXcodeProject } = require('@expo/config-plugins');

const source = name => fs.readFileSync(path.join(__dirname, 'widgets', name), 'utf8');

// Run after expo-widgets. Keep its target, entitlements, configuration intent
// identities and Live Activity, but render planner widgets in native SwiftUI.
// Source lives here so clean prebuilds reproduce the complete implementation.
module.exports = config => {
  const plugin = config.plugins.find(value => Array.isArray(value) && value[0] === 'expo-widgets');
  if (!plugin) throw new Error('withNativePlannerWidgets must follow expo-widgets');
  const widgets = plugin[1].widgets;
  for (const name of ['PlannerWidgetStore.swift', 'PlannerWidgetsBridge.swift', 'PlannerWidgetsBridge.m']) {
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
    Timeline(entries: PlannerWidgetTimeline.entries(options: options(configuration)), policy: .atEnd)
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
`;
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
`;
      }
      if (widget.name === 'DueToday') {
        output += '\n' + source('PlannerWidgetStore.swift') + '\n' + source('PlannerWidgetViews.swift');
      }
      fs.writeFileSync(file, output);
    }
    return result;
  });
};
