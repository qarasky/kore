# Releasing

How KoreCalendar is versioned, tagged and published. For running a release, see [deploy.md](deploy.md).

## One version for the server, one tag per release

The API and the web app are released together, as one version:

| What | Where | Example |
| --- | --- | --- |
| git tag | the repository | `v0.2.0` |
| API image | `ghcr.io/qarasky/korecalendar-api` | `0.2.0`, `0.2`, `latest` |
| web image | `ghcr.io/qarasky/korecalendar-web` | `0.2.0`, `0.2`, `latest` |
| the binary | `korecalendar version` and the startup log | `korecalendar 0.2.0 (3f9c1ab)` |
| GitHub release | Releases page, with generated notes | `KoreCalendar 0.2.0` |
| `web/package.json` | bumped by `scripts/release.sh` | `"version": "0.2.0"` |

[Semantic Versioning](https://semver.org/). While the version is `0.x`, anything may change between minors; read the release notes before updating. The git tag is the single source of truth: the images are stamped from it, never the other way round.

The REST contract has its own number, `info.version` in [openapi.yaml](openapi.yaml). It changes only when the contract does, not on every release.

## Image tags

| Event | Tags pushed (api and web, identical) |
| --- | --- |
| tag `v1.2.3` | `1.2.3`, `1.2`, `1`, `latest` |
| tag `v0.2.0` | `0.2.0`, `0.2`, `latest` (no `0`: a `0.x` minor may break) |
| tag `v1.0.0-rc.1` | `1.0.0-rc.1` only (a pre-release is never `latest`) |
| push to `main` | `edge`, `sha-<7 chars>` |

Pin `KORECAL_VERSION` in `.env` to an exact release for a server you care about. `latest` follows the newest stable release, `edge` follows `main` and is for trying things. Every image is `linux/amd64` and `linux/arm64`, and carries a signed build provenance attestation (`gh attestation verify oci://ghcr.io/qarasky/korecalendar-api:0.2.0 --owner qarasky`).

## Cutting a release

1. Be on an up-to-date, clean `main` whose last [CI run](../.github/workflows/ci.yml) is green.
2. `scripts/release.sh 0.2.0` bumps `web/package.json`, commits `release: v0.2.0` and creates the annotated tag `v0.2.0`. It refuses a dirty tree, a branch other than `main`, a `main` that differs from `origin/main`, a malformed version or an existing tag.
3. `git push origin main v0.2.0`.
4. The `images` workflow ([images.yml](../.github/workflows/images.yml)) then runs, and stops at the first failure:
   1. the whole test suite (Go, web unit, Playwright);
   2. four builds, each on a native runner (api and web, amd64 and arm64);
   3. one multi-arch tag per image, plus the provenance attestation;
   4. [scripts/smoke.sh](../scripts/smoke.sh) starts the stack from the **published** images and checks the health endpoint, the login page and CalDAV, and that the binary reports exactly `0.2.0`;
   5. the GitHub release, with generated notes (a pre-release when the version has a `-suffix`).

A tag whose run fails is fixed forward: delete the tag and any images it pushed, fix the problem, and release again (or release the next patch). Images are never overwritten under a release number.

## Visibility of the packages

GitHub decides a package's visibility when it is first published. For this repository both images came out **public**, so anyone can `docker pull` them without logging in; check with
`docker logout ghcr.io && docker manifest inspect ghcr.io/qarasky/korecalendar-api:latest`. If a fork's packages come out private, make each public under the owner's Packages →
the package → Package settings → Change visibility (this cannot be done through the API).

## Android

The Android app is released from the same repository with its own tags, so the server and the app move independently.

| What | Where | Example |
| --- | --- | --- |
| git tag | the repository | `android-v0.2.0`, `android-v1.0.0-rc.1` |
| version | `android/version.properties`, written by `scripts/release-android.sh` | `versionName=0.2.0`, `versionCode=20099` |
| release | GitHub Releases, tag `android-v…` | `KoreCalendar for Android 0.2.0` |
| files | on the release | `korecalendar-0.2.0.apk`, `korecalendar-0.2.0.apk.sha256` |

Server tags (`vX.Y.Z`) do not trigger the Android workflow and Android tags do not trigger the server's `images` workflow. The app is not tied to a server version: it talks to the public REST API, whose
contract is versioned separately (above).

### `versionCode`

Android only installs an update whose `versionCode` is higher, so it is derived from the version and only ever increases: `major*1000000 + minor*10000 + patch*100 + slot`, where `slot` is `99` for a
final release and `N` for `-rc.N`. So `0.1.0` is `10099`, `1.0.0-rc.1` is `1000001` and `1.0.0` is `1000099`: a release candidate sorts below its final release. (Limits: major below 2000, minor and patch below 100,
rc 1 to 98.) `bash scripts/test-android-version.sh` checks the scheme.

### Cutting an Android release

1. Be on an up-to-date, clean `main`. [android-ci](../.github/workflows/android-ci.yml) runs on pull requests (lint, JVM and contract tests, and the emulator UI flows) and again on the tag before anything is signed (without the emulator job); the PR that went in must have been green.
2. `scripts/release-android.sh 0.2.0` writes `android/version.properties`, commits `android release: v0.2.0` and creates the annotated tag `android-v0.2.0`. It refuses a dirty tree, a branch other than `main`,
   a `main` that differs from `origin/main`, a malformed version or an existing tag.
3. `git push origin main android-v0.2.0`.
4. [android-release.yml](../.github/workflows/android-release.yml) then runs and stops at the first failure: it checks that the tag matches `version.properties` and is on `main`; runs the checks (version-code
   tests, Android lint, unit and contract tests, debug build); decodes the keystore from the repository secrets; builds the **release APK signed with the release key**; runs `apksigner verify`; compares the
   certificate's SHA-256 with [android/signing-fingerprint.txt](../android/signing-fingerprint.txt) (an APK signed by any other key fails the release); writes the checksum; and creates the GitHub release
   (a pre-release when the version has `-rc.N`) with the APK and checksum attached. There is no unsigned fallback.

### Android signing key

The release key lives only in four repository **secrets**: `KORECAL_KEYSTORE_BASE64` (the keystore file, base64), `KORECAL_KEYSTORE_PASSWORD`, `KORECAL_KEY_ALIAS` and `KORECAL_KEY_PASSWORD`.
`android/signing-fingerprint.txt` holds the certificate's SHA-256 (public, not a secret). To check the secrets after changing them, run the **Android signing check** workflow by hand: it opens the keystore,
confirms the alias and the key password and prints the fingerprint. It publishes nothing.

**Keep a copy of the keystore file and its passwords outside GitHub.** GitHub never shows a secret again. If the key is lost you can never publish an update that installs over the existing app: every phone
would have to uninstall it (losing the local copy) and install a new one signed with a new key.
