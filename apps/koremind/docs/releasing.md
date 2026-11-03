# Releasing KoreMind

One version number covers everything: the backend and web Docker images, the Android app and the GitHub Release all carry the same `X.Y.Z`. Releasing is: bump, commit, tag, push. CI does the rest.

## What runs when

| Trigger | Workflow | Result |
|---|---|---|
| Pull request | `ci.yml` | Tests, web typecheck and build, Android unit tests and debug APK (kept as a 7-day artifact), Docker images build (not pushed). |
| Push to `main` | `ci.yml` + `docker.yml` | Same checks, then images `:edge` and `:sha-<short>` on GHCR. |
| Tag `vX.Y.Z` or `vX.Y.Z-rc.N` | `release.yml` | Verify, test, publish images, build and sign the APK, create the GitHub Release. |

## Cutting a release

```bash
git checkout main && git pull
bun scripts/version.ts set 0.2.0            # edits the 4 package.json files and android/version.properties
git commit -am "release: 0.2.0"
# open a PR / merge to main as usual, then on the merge commit:
git tag v0.2.0
git push origin v0.2.0
```

`release.yml` refuses to continue when:

- the tag does not match the version in **every** file (`bun scripts/version.ts verify v0.2.0`),
- the tagged commit is not on `main`,
- the tests fail,
- the Android signing secrets are missing.
- the APK is not signed by the certificate recorded in `android/signing-fingerprint.txt` (run the **Android signing check** workflow to print the stored key's SHA-256).

When it finishes you have a GitHub Release `KoreMind 0.2.0` with the signed APK and its `.sha256`, auto-generated notes grouped by label (`.github/release.yml`), and install commands.

### Pre-releases

`v0.2.0-beta.1` and `v0.2.0-rc.1` (only `beta.N` and `rc.N`, N from 1 to 48) go through the same pipeline. The GitHub Release is marked *pre-release*, and the images get **only** the exact tag: no `:latest`, `:0.2` or `:0`.

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

An Android app must be signed with the same key for every update, or phones refuse to upgrade it. **Create the key once and back it up outside GitHub** (a password manager works). If you lose it, the only way out is to uninstall and reinstall on every phone.

```bash
keytool -genkeypair -v -keystore koremind-release.jks -alias koremind \
  -keyalg RSA -keysize 4096 -validity 10000
# answer the prompts; remember the store password and the key password

base64 -i koremind-release.jks | gh secret set KOREMIND_KEYSTORE_BASE64 --repo qarasky/koremind
gh secret set KOREMIND_KEYSTORE_PASSWORD --repo qarasky/koremind
gh secret set KOREMIND_KEY_ALIAS --repo qarasky/koremind --body koremind
gh secret set KOREMIND_KEY_PASSWORD --repo qarasky/koremind
```

Local release builds use the same variables (`KOREMIND_KEYSTORE_FILE` as a path instead of base64). Without them `assembleRelease` produces an unsigned APK, which phones will not install.

The debug APK from `ci.yml` is signed with a throw-away debug key. It is fine for trying a change, but it cannot be updated by, or replace, a release build.

## If a release goes wrong

- **Verification failed before anything was published:** fix, commit, delete the tag (`git push origin :refs/tags/v0.2.0 && git tag -d v0.2.0`), tag again.
- **Images were published but the APK failed:** re-run the failed jobs from the Actions page. Re-publishing the same tag is safe; it overwrites the same tags with the same content.
- **A published release is bad:** do not move or delete the tag. Fix forward with the next patch version, and mark the bad GitHub Release as pre-release (or delete just the Release) so it is not offered as latest.
