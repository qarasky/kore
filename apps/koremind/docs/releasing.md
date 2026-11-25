# Releasing KoreMind

One version number covers everything: the backend and web Docker images, the Android app and the GitHub Release all carry the same `X.Y.Z`. Releasing is: bump, commit, tag, push. CI does the rest.

## What runs when

| Trigger | Workflow | Result |
|---|---|---|
| Pull request | `koremind-ci.yml` | Tests, web typecheck and build, Android unit tests and debug APK (kept as a 7-day artifact), Docker images build (not pushed). |
| Push to `main` | `koremind-ci.yml` + `koremind-images.yml` | Same checks, then images `:edge` and `:sha-<short>` on GHCR. |
| Tag `koremind-vX.Y.Z` or `koremind-vX.Y.Z-rc.N` | `koremind-release.yml` | Verify, test, publish images, build and sign the APK, create the GitHub Release, and (full releases only) update `koremind-android.json` on the rolling release `koremind-android-latest`, where installed apps look for updates. |

## Cutting a release

```bash
git checkout main && git pull
cd apps/koremind
bun scripts/version.ts set 0.2.0            # edits the 4 package.json files and android/version.properties
git commit -am "release: koremind 0.2.0"
# open a PR / merge to main as usual, then on the merge commit:
git tag koremind-v0.2.0
git push origin koremind-v0.2.0
```

`koremind-release.yml` refuses to continue when:

- the tag does not match the version in **every** file (`bun scripts/version.ts verify koremind-v0.2.0`),
- the tagged commit is not on `main`,
- the tests fail,
- the Android signing secrets are missing.
- the APK is not signed by the certificate recorded in `android/signing-fingerprint.txt` (run the **Android signing check** workflow to print the stored key's SHA-256).

When it finishes you have a GitHub Release `KoreMind 0.2.0` with the signed APK and its `.sha256`, auto-generated notes grouped by label (`.github/release.yml` at the monorepo root), and install commands.

### Pre-releases

`koremind-v0.2.0-beta.1` and `koremind-v0.2.0-rc.1` (only `beta.N` and `rc.N`, N from 1 to 48) go through the same pipeline. The GitHub Release is marked *pre-release*, and the images get **only** the exact tag: no `:latest`, `:0.2` or `:0`.

## Docker images

Both images are multi-arch (`linux/amd64`, `linux/arm64`), each built on a native runner, and carry build provenance attestations.

| Image | Tags |
|---|---|
| `ghcr.io/qarasky/koremind-backend` | `0.2.0`, `0.2`, `0`, `latest` (release); `0.2.0-rc.1` (pre-release); `edge`, `sha-abc1234` (main) |
| `ghcr.io/qarasky/koremind-web` | same |

The backend image bundles OpenCode v2, pinned by `OPENCODE_VERSION` in `backend/Dockerfile`. Bump it on purpose, in its own commit, after trying the new engine.

**First publish only:** GHCR creates new packages as private. Open each package under the repository's *Packages* and set *Change visibility → Public* once (or `docker login ghcr.io` on the servers that pull). After that nothing needs changing.

## Android versions

`android/version.properties` holds `versionName` and `versionCode`, written by `scripts/version.ts` and read by Gradle. `versionCode` is derived from the version so it only ever grows:

```
versionCode = major*1_000_000 + minor*10_000 + patch*100 + slot
slot        = 1-49 for beta.N, 51-98 for rc.N, 99 for the final release
```

So `0.2.0-rc.1` (20051) < `0.2.0` (20099) < `0.2.1` (20199). Android refuses to install a lower `versionCode` over a higher one, which is why it must never go backwards. The release job checks that the built APK reports exactly the expected name and code.

### Android signing key

The key was replaced on 2026-11-26 (the old one was lost): an app installed from an earlier release must be uninstalled once and the new release installed; updates install over it from then on.

An Android app must be signed with the same key for every update, or phones refuse to upgrade it. **Create the key once and back it up outside GitHub** (a password manager works). If you lose it, the only way out is to uninstall and reinstall on every phone.

```bash
keytool -genkeypair -v -keystore koremind-release.jks -alias koremind \
  -keyalg RSA -keysize 4096 -validity 10000
# answer the prompts; remember the store password and the key password

base64 -i koremind-release.jks | gh secret set KOREMIND_KEYSTORE_BASE64 --repo qarasky/kore
gh secret set KOREMIND_KEYSTORE_PASSWORD --repo qarasky/kore
gh secret set KOREMIND_KEY_ALIAS --repo qarasky/kore --body koremind
gh secret set KOREMIND_KEY_PASSWORD --repo qarasky/kore
```

Local release builds use the same variables (`KOREMIND_KEYSTORE_FILE` as a path instead of base64). Without them `assembleRelease` produces an unsigned APK, which phones will not install.

The debug APK from `ci.yml` is signed with a throw-away debug key. It is fine for trying a change, but it cannot be updated by, or replace, a release build.

### In-app updates

Release builds update themselves from GitHub. Every release also uploads `koremind-android.json` (version, `versionCode`, APK link, SHA-256). The app reads `https://github.com/<repo>/releases/latest/download/koremind-android.json` when it starts (at most every 6 hours) and from **Settings → Account → Updates**. If `versionCode` is higher, a banner offers the update. Tapping it downloads the APK, checks the SHA-256 and hands it to Android's installer.

- Only full releases are offered. `releases/latest` skips pre-releases, so `-rc` tags never reach phones this way.
- The first update asks the user to allow "Install unknown apps" for KoreMind and to confirm. On Android 12 and later, updates after that install without a prompt.
- Android only installs an APK signed with the same key as the installed app, so the signing key above protects updates too.
- Debug builds don't check for updates, because they're signed with a different key.
- The repo comes from `GITHUB_REPOSITORY` at build time (a fork updates from itself). Locally it defaults to `qarasky/koremind`, or set `-PupdateRepo=owner/name`.

## If a release goes wrong

- **Verification failed before anything was published:** fix, commit, delete the tag (`git push origin :refs/tags/v0.2.0 && git tag -d v0.2.0`), tag again.
- **Images were published but the APK failed:** re-run the failed jobs from the Actions page. Re-publishing the same tag is safe; it overwrites the same tags with the same content.
- **A published release is bad:** do not move or delete the tag. Fix forward with the next patch version, and mark the bad GitHub Release as pre-release (or delete just the Release) so it is not offered as latest.
