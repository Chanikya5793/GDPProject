# NW Student Planner — mobile

Expo app, iOS first. Mirrors the web client and talks to the same Cloud Run
backend.

## Running it

```bash
npm install
npm run ios          # expo run:ios, on a simulator or a connected device
```

`npm run typecheck` and `npm run test` are what CI runs. There is no build step
in CI on purpose: GitHub's Linux runners cannot build iOS, and shipping happens
from a Mac anyway, so a cloud build there would only produce an artifact nobody
collects.

## Shipping a build

```bash
npm run build:ios    # eas build --platform ios --profile production --local
npm run submit:ios   # eas submit --platform ios
```

The build runs on this machine rather than EAS servers: no queue, no build
quota, and the `.ipa` lands here ready to submit. `submit:ios` asks which
artifact to send; `--path <file>` skips the question. Transporter works just as
well if you would rather drag the file.

`eas.json` sets `autoIncrement`, so the build number goes up on its own.

## Configuration, and the trap in it

Everything the app needs to reach the backend is baked in **at build time** from
`EXPO_PUBLIC_*` values:

| | |
| --- | --- |
| `EXPO_PUBLIC_PLANNER_API_URL` | the Cloud Run service |
| `EXPO_PUBLIC_FIREBASE_*` | project, app id, auth domain, web API key |

They live in **`eas.json`**, under `env` on every build profile, which is what
`eas build` reads — cloud or `--local`. A local `.env` also works for
`expo run:ios` during development, but it is gitignored, so it does not exist on
a fresh checkout and it is not what a build uses.

This is worth knowing because getting it wrong is silent. With those values
missing, `apiConfigured()` is false, sign-in falls back to demo mode, and the
assistant tab reports itself unavailable with its input disabled — an app that
launches, looks fine, and quietly has no assistant in it. That shipped to a real
device once. `utils/easConfig.test.ts` walks every build profile and fails if any
of them loses the config, so it cannot happen quietly again.

The values are public by design: they already ship inside the binary and inside
the web bundle. Nothing is protected by hiding them — `firestore.rules` denies
client access outright, and every API call is authorised from a Firebase ID
token the backend verifies with `check_revoked=True`.

## Layout

| | |
| --- | --- |
| `app/(tabs)/` | the screens, expo-router |
| `api/` | backend client, encrypted per-user device storage |
| `utils/` | pure logic, which is where the tests are |
| `theme/` | colours and light/dark |

The mobile test suite is pure functions only — there is no React Native
renderer — so logic worth pinning belongs in `utils/` rather than inside a
screen where nothing can reach it.
