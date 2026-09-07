const { withEntitlementsPlist } = require('@expo/config-plugins');

// Installing expo-notifications auto-applies its config plugin, and that plugin
// writes `aps-environment` — the Apple Push Notification entitlement — whether
// or not the app is listed under `plugins` in app.json. This app schedules its
// alerts locally: no push token is ever registered and no server ever sends a
// notification, so the entitlement claims a capability that is never used.
//
// Dropping it is not cosmetic. An entitlement has to be matched by the
// provisioning profile, so keeping it would mean enabling Push Notifications on
// the App ID and re-issuing credentials before the next TestFlight build could
// be signed — capability churn in exchange for nothing. Local scheduling needs
// no entitlement at all.
//
// Runs as a config plugin because ios/ is generated and gitignored; an edit to
// the entitlements file itself would be discarded by the next prebuild. It must
// be listed after any plugin that could add the key back.

module.exports = config =>
  withEntitlementsPlist(config, cfg => {
    delete cfg.modResults['aps-environment'];
    return cfg;
  });
