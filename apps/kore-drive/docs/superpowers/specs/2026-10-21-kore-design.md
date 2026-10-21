# Kore: design

## Intent

The owner runs a small office (3-4 people) with its own Ubuntu server. They want a web UI to store, browse, share and download files on it, without paying for Google Workspace. Existing options failed them:

- **NextCloud:** slow, hard to configure, full of features they don't need, UI resembles Bitrix (which they dislike).
- **Quantum (FileBrowser Quantum):** too basic, ugly UI.

Kore is a small, fast, Google-Drive-like file server. Success means: install is trivial, it feels as polished and fast as Drive, and nothing in it is surplus.

Typical content: documents, some videos. Nothing heavy.

## Goals

1. Very easy install: Docker Compose plus one small config file.
2. Email + password auth. Roles: `admin` and `user`.
3. Drive-like UX: drag and drop upload, create folders, drag files and folders into other folders, move/rename/delete.
4. Each user has a **personal space**; everyone shares one **shared space**.
5. Per-user storage quota, set by an admin.
6. Preview for text-like files only (`.txt`, `.md`, source code and similar). No preview for other types, no in-browser editing.
7. Trash: deleted files go to a trash folder first.
8. **Public share links** (nice-to-have, after core): a link to one file or folder opens a page for just that item with a download button and a preview where one exists. No account required.
9. All settings except bootstrap ones are editable in an **admin panel** (think Google Workspace admin console).
10. Large video uploads must work through Cloudflare Tunnel.

## Non-goals

- Office-document editing, collaboration, calendars, contacts, apps, plugins: the NextCloud feature set.
- Previews for images, video, PDF, Office files (explicitly not wanted for now).
- Self-signup, invite links, SSO/OAuth. Admin creates every account.
- ZFS support. The server has no ZFS; the owner thought it did. Storage is mdadm RAID (ext4).

## Anti-goals (would be failure even if it technically works)

- Becoming slow or heavy like NextCloud.
- A UI that looks like Bitrix or Quantum.
- A client-rendered app whose routing breaks (owner has been burned by this).
- Complicated configuration.

## Constraints and decisions made by the owner

- **Frontend:** Next.js **with SSR** (not static export, not client-only routing), so routes work normally.
- **Backend:** fast language, **not Python and not JavaScript**. The owner left the choice to the builder; see "my calls" below.
- **Deployment:** Docker (already installed on the server). Production sits behind a **Cloudflare Tunnel** at `files.example.com`.
- **Network binding:** configurable, including `0.0.0.0` so it can be reached over LAN or Tailscale directly.
- **Cloudflare Tunnel limit:** the free plan rejects request bodies over 100 MB, so uploads must be chunked (and resumable). Downloads are unaffected.
- **Storage:** mdadm RAID mirror mounted at `/mnt/mirror` (ext4, ~916 GB). A second single disk is at `/mnt/storage` (~916 GB). Quotas are enforced by the app, not the filesystem.
- **UI direction:** Google Drive layout (sidebar, breadcrumbs, drag and drop), in a **dark, compact look with a list view by default**, as chosen from mockups (option B: dark surfaces, ~6px corners, dense rows, blue accent `#5b8def`, sidebar with My files / Shared space / Trash / storage meter). Mockup: `docs/superpowers/specs/mockups/main-view.html`.
- **Accounts:** admin creates users; roles are admin and user.
- **Trash:** deleted files go to a trash folder, not straight to deletion.
- **Config split:** the config file holds only what the app needs before it can start (port, bind address, data directory, first admin account). Everything else lives in the admin panel and the app's database.

## Target environment (checked over SSH, read-only)

Ubuntu Server 26.04.1, x86_64, 20 cores, 61 GB RAM. Docker 29 and Compose 5 installed; the `office` user is in the `docker` group. `/dev/md0` ext4 mirror at `/mnt/mirror`; `/dev/sdc1` ext4 at `/mnt/storage`; boot disk is separate. No `zpool`/`zfs`.

## My calls (the owner did not decide these; they can overrule)

- **Backend language: Go.** Fast, good at streaming files, simple to write and containerize.
- **Files stay as ordinary files on disk**, with metadata (users, folders, quotas, shares, settings) in an embedded database (SQLite).
- **App-level quota accounting** (bytes counted by the app), not filesystem quotas.
- **Startup safety check:** refuse to start unless a marker file proves the real storage volume is mounted, so a late mount can't cause writes into an empty directory.
- Which settings the admin panel exposes beyond users, quotas, trash retention, upload limits and share-link rules is left to the builder.
- Default values for trash retention, share-link expiry and the default bind address are left to the builder, with sane, safe defaults (bind to localhost by default).

## Further decisions

Decided by the owner:

- **Shared space:** every user can rename, move and delete anything in it.
- **On-disk layout:** owner will never access files over SSH, so the layout is the builder's choice (an opaque, ID-based layout is fine and makes rename/move cheap).
- **Language:** UI is English at launch, but built so Russian can be added later (all strings externalized; Unicode filenames handled correctly).

My calls (owner can overrule):

- **Single public origin.** The Compose stack includes a small reverse proxy (e.g. Caddy) routing `/api` and file transfer paths straight to the Go service and everything else to Next.js, so large uploads and downloads never pass through Node. LAN/Tailscale access uses the same entry point.
- **Admins cannot browse other users' personal spaces.** They manage accounts, quotas and settings and can see usage totals only.
- **Quota accounting:** trashed files count toward the owner's quota until purged; files in the shared space count against the uploader; in-flight uploads reserve quota. Emptying trash frees space.
- **Storage:** only `/mnt/mirror` is used (`/mnt/storage` is out of scope). Files, trash and SQLite live on the same volume so moves are atomic.
- **Core features included:** folder and multi-select download as streamed zip; filename search.
- **Uploads:** name collisions keep both (numbered suffix); maximum file size is an admin setting, unlimited by default; resumable across network drops and browser restarts.
- **Accounts:** admin sets/resets passwords; users can change their own; login is rate-limited. Deleting a user requires the admin to delete or reassign that user's files.
- **Share links (when built):** folders browsable and downloadable as zip; optional password and expiry; a link stops working if its item is trashed or deleted.
- **Mockups** are copied into `docs/superpowers/specs/mockups/` so they are in the repo.

## Left to the builder

API design, database schema, auth/session mechanism, chunked-upload protocol, how the Next.js and Go services talk to each other, Compose layout, testing approach, and visual detail within the chosen direction.
