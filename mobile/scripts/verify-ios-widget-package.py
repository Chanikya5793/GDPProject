#!/usr/bin/env python3
"""Verify WidgetKit's actual action registrations in an exported iOS IPA.

Rendering SwiftUI or invoking perform() directly cannot prove that iOS can
resolve an archived widget button. Both target registries must contain its
intent, and missing all-day/undated fields must remain optional.
"""
import argparse
import json
import plistlib
import zipfile


def verify(path):
    intents = {"CompletePlannerWidgetIntent", "UndoPlannerWidgetIntent", "SelectPlannerWidgetIntent"}
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None, "IPA archive is corrupt"
        registries = [name for name in archive.namelist() if name.endswith("Metadata.appintents/extract.actionsdata")]
        app = next(name for name in registries if ".appex/" not in name)
        widget = next(name for name in registries if "/ExpoWidgetsTarget.appex/" in name)
        versions = []
        for name in [app, widget]:
            target = name.split("/Metadata.appintents/")[0]
            info = plistlib.loads(archive.read(target + "/Info.plist"))
            versions.append((info["CFBundleShortVersionString"], info["CFBundleVersion"]))
            actions = json.loads(archive.read(name))["actions"]
            missing = intents - set(actions)
            assert not missing, f"{info['CFBundleIdentifier']}: missing widget actions {sorted(missing)}"
            for intent in intents:
                assert not actions[intent].get("openAppWhenRun", False), f"{intent} must run without opening the app"
            parameters = {p["name"]: p for p in actions["CompletePlannerWidgetIntent"]["parameters"]}
            for field in ["date", "time"]:
                assert parameters[field]["isOptional"], f"Completion incorrectly requires {field}"
            print(f"{info['CFBundleIdentifier']}: all three widget actions registered; date/time optional; no forced launch")
        assert versions[0] == versions[1], "App and widget versions differ"
        print(f"Widget interaction package verified: {versions[0][0]} ({versions[0][1]})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ipa")
    try:
        verify(parser.parse_args().ipa)
    except (AssertionError, KeyError, StopIteration, zipfile.BadZipFile) as error:
        raise SystemExit(f"Widget interaction package FAILED: {error}")
