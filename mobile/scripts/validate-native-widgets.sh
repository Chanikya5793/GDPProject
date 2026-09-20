#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
widget_qa_dir="$(mktemp -d /tmp/nw-widget-qa.XXXXXX)"
widget_app="$widget_qa_dir/WidgetHarness.app"
mkdir -p "$widget_app"
xcrun swiftc -D WIDGET_TESTS -parse-as-library -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" \
  -target arm64-apple-ios17.0-simulator plugins/widgets/PlannerWidgetStore.swift \
  plugins/widgets/PlannerWidgetViews.swift tests/widgets/WidgetHarness.swift -o "$widget_app/WidgetHarness"
cat > "$widget_app/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.nwmissouri.widget-validation</string>
<key>CFBundleExecutable</key><string>WidgetHarness</string>
<key>CFBundleName</key><string>Widget validation</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>UILaunchScreen</key><dict/>
<key>UIApplicationSceneManifest</key><dict><key>UIApplicationSupportsMultipleScenes</key><false/></dict>
</dict></plist>
PLIST
codesign --force --sign - "$widget_app"
xcrun simctl terminate booted com.nwmissouri.widget-validation 2>/dev/null || true
xcrun simctl install booted "$widget_app"
widget_data="$(xcrun simctl get_app_container booted com.nwmissouri.widget-validation data)"
rm -f "$widget_data/Documents/result.txt"
xcrun simctl launch booted com.nwmissouri.widget-validation
for ((attempt=0; attempt<30; attempt++)); do
  if [ -f "$widget_data/Documents/result.txt" ]; then
    cat "$widget_data/Documents/result.txt"
    printf 'Native results directory: %s\n' "$widget_data/Documents"
    exit 0
  fi
  sleep 1
done
printf 'Native validation did not finish. Inspect the simulator crash log.\n' >&2
exit 1
