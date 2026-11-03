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

## First setup (once per package)

GitHub creates a package **private** the first time it is pushed. After the first release, open each of the two packages on `https://github.com/qarasky?tab=packages` → Package settings → Change visibility → Public. (This cannot be done from the API.) Until then only the owner can `docker pull` them.

## Android (planned)

The Android app is released from the same repository with its own tags, so the server and the app can move independently:

- `android-v1.4.0` is the app. The server workflow above ignores it (its tag filter is `v[0-9]*`), and the Android workflow will ignore server tags.
- The app is not tied to a server version: it talks to the public REST API, whose contract is versioned separately (above).
