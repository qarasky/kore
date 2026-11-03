# Deploying KoreMind on Linux

> Prefer containers? [docs/deployment-docker.md](deployment-docker.md) runs the same thing from prebuilt images, with no Bun or OpenCode to install.

How to run KoreMind as a service on a Linux server (a home server, a mini PC, a VPS). Written for Debian/Ubuntu-style systems with systemd; other distributions need only the package names changed.

> **Status.** These steps were written from how KoreMind runs on the author's Mac and from the project's own start script and tests. They have **not** been run on a real Linux host yet. Expect to fix a small thing or two on the first try, and please correct this document when you do.

## 1. What runs

One service, `koremind`, started with `bun run start`. It launches two processes that you do not need to manage separately:

| Process | Port | Notes |
| --- | --- | --- |
| Backend (Bun) | `8787` | REST + SSE API. Binds all interfaces. It starts and owns the OpenCode engine. |
| Web UI (Next.js, production build) | `3210` | Talks to the backend by URL from the browser. |
| OpenCode engine | random, `127.0.0.1` only | Started by the backend. Never reachable from outside. |

Everything KoreMind stores lives under one directory, `KOREMIND_DATA_DIR` (this guide uses `/var/lib/koremind`).

## 2. Requirements

- A 64-bit Linux (x86-64 or ARM64) with systemd, `curl`, `git`, `unzip`.
- 1 GB of RAM is enough for one person; the models run on the provider's servers, not here.
- Outbound internet (OpenCode, OpenRouter, web search).
- Optional: Tailscale or a Cloudflare tunnel for use away from home (section 6).

## 3. Install

Run as a normal user with `sudo`. Replace the repository URL with yours.

```bash
# 3.1 A dedicated user and directories
sudo useradd --system --create-home --home-dir /home/koremind --shell /bin/bash koremind
sudo mkdir -p /opt/koremind /var/lib/koremind /etc/koremind
sudo chown koremind:koremind /opt/koremind /var/lib/koremind
sudo chmod 700 /var/lib/koremind            # holds provider keys and chats

# 3.2 Bun and OpenCode for that user
sudo -iu koremind bash -c 'curl -fsSL https://bun.sh/install | bash'
sudo -iu koremind bash -c 'curl -fsSL https://opencode.ai/v2/install | bash'
sudo -iu koremind bash -c 'command -v bun; command -v opencode; opencode --version'
```

The last line must print two paths and a version starting with `v2`. KoreMind needs OpenCode **v2**; the older v1 has a different API. If `opencode` is not on the PATH, find where the installer put it and use that path in `KOREMIND_OPENCODE_BIN` (step 3.4). The standalone binaries on <https://opencode.ai/v2/docs/> also work.

```bash
# 3.3 Get the code and build the web UI
sudo -u koremind git clone git@github.com:qarasky/koremind.git /opt/koremind      # or your remote
sudo -iu koremind bash -c 'cd /opt/koremind && bun install && bun run build'

# 3.4 Configuration
sudo cp /opt/koremind/deploy/koremind.env.example /etc/koremind/koremind.env
sudo chown root:koremind /etc/koremind/koremind.env && sudo chmod 640 /etc/koremind/koremind.env
sudoedit /etc/koremind/koremind.env              # at least check KOREMIND_OPENCODE_BIN

# 3.5 The service
sudo cp /opt/koremind/deploy/koremind.service /etc/systemd/system/koremind.service
sudo systemctl daemon-reload
sudo systemctl enable --now koremind
```

If you installed Bun or OpenCode somewhere other than `/home/koremind/.bun` and `/home/koremind/.opencode`, edit `ExecStart` and `Environment=PATH=` in the unit first. systemd gives services a minimal `PATH`, which is the usual reason for "command not found" at start.

## 4. First start

```bash
systemctl status koremind
journalctl -u koremind -f                    # logs; Ctrl-C to leave
curl http://localhost:8787/health        # {"name":"koremind","version":"…","setupRequired":true}
```

The log lists the addresses the backend is reachable at (local network, Tailscale, your `KOREMIND_PUBLIC_URL`).

**Create the owner account right away.** Open `http://<server-address>:3210` from a computer on the same network and register. The first account becomes the owner and registration then closes. Do this *before* exposing the server anywhere else.

Then, in **Settings → Providers**, add a key for OpenRouter or Codex if you want more than OpenCode's free models. (Only the owner can change providers.)

## 5. The phone

1. Build or fetch the APK. On any machine with a JDK 17+ and the Android SDK: `cd android && ./gradlew :app:assembleDebug`; the file is `android/app/build/outputs/apk/debug/app-debug.apk`. Copy it to the phone (`adb install -r app-debug.apk`, or any file transfer) and allow installs from that source.
2. In the web UI open **Settings → Account → Show QR code**.
3. In the app tap **Scan QR code** and point it at the screen. The phone tries each address in the code until one works, and signs in as you. Scanning needs Google Play services on the phone; otherwise type an address into **Backend URL** and sign in by hand.

The app allows plain `http://` to the address you give it, because KoreMind does not set up TLS itself.

## 6. Reaching KoreMind away from home

KoreMind deliberately does not configure tunnels or certificates. Choose one:

**Tailscale (simplest).** Install it on the server (`curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`) and on your phone and laptop. KoreMind prints the server's Tailscale address (a `100.x.y.z` address) at start and includes it in the QR code. Nothing else to do.

**Cloudflare Tunnel or your own domain.** The web UI and the backend are two separate origins, so give each a hostname:

| Hostname (example) | Points to |
| --- | --- |
| `koremind.example.com` | `http://localhost:3210` |
| `api.koremind.example.com` | `http://localhost:8787` |

Then set `KOREMIND_PUBLIC_URL=https://api.koremind.example.com` in `/etc/koremind/koremind.env` and `sudo systemctl restart koremind`. Notes:

- Use HTTPS for **both**. A page served over HTTPS cannot call an `http://` backend (browsers block it).
- The web UI guesses its backend as `<this host>:8787`, which only fits the plain local setup. On the first visit through hostnames, the **Connect to your server** screen appears: enter `https://api.koremind.example.com`.
- Streaming answers need the proxy not to buffer. The backend already sends `x-accel-buffering: no`; on nginx also set `proxy_buffering off;` and a long `proxy_read_timeout` for the API host.
- A proxy on this machine is recognised automatically, so login rate limiting sees the real client address. Set `KOREMIND_TRUST_PROXY=1` only if the proxy is on a different machine.
- **Do not expose `/mcp`.** It is how the local OpenCode engine reaches KoreMind's notes tools. It only accepts loopback callers with a secret that changes at every start, but add a deny rule for `/mcp` in your proxy anyway.

## 7. Firewall

Allow `8787` and `3210` only from where you need them. With ufw:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 8787,3210 proto tcp   # your LAN
sudo ufw allow in on tailscale0                                       # Tailscale
sudo ufw enable
```

Do not open `8787` to the whole internet over plain HTTP: passwords and chats would cross the network unencrypted. Login has rate limiting (5 wrong attempts per 15 minutes per address and email), which is a guard rail, not a substitute for TLS or Tailscale.

## 8. Operating it

| Task | Command |
| --- | --- |
| Status / logs | `systemctl status koremind` / `journalctl -u koremind -f` |
| Restart | `sudo systemctl restart koremind` |
| Update | `sudo -iu koremind bash -c 'cd /opt/koremind && git pull && bun install && bun run build'` then `sudo systemctl restart koremind` |
| Check health | `curl http://localhost:8787/health` |
| Stop | `sudo systemctl stop koremind` (this also stops the OpenCode engine) |

Database migrations run automatically when the backend starts.

### Backups

Back up `/var/lib/koremind`. It contains:

| Path | What |
| --- | --- |
| `koremind.sqlite` (+ `-wal`, `-shm`) | accounts, chats, notes, settings |
| `users/<id>/memory.md` | each user's memory |
| `uploads/` | attachments |
| `opencode/` | the engine's state, **including provider API keys and sign-ins** |

The simplest safe backup is to stop the service, copy, and start it again:

```bash
sudo systemctl stop koremind && sudo tar czf /root/koremind-$(date +%F).tgz -C /var/lib koremind && sudo systemctl start koremind
```

For a live backup of the database alone: `sqlite3 /var/lib/koremind/koremind.sqlite ".backup '/root/koremind.sqlite'"`. Treat backups like secrets, since they include the provider keys.

### Signing in with ChatGPT on a headless server

The Codex **Sign in with ChatGPT** flow finishes in a browser on the machine that runs the engine: the login page sends the browser back to `127.0.0.1:<port>` on *that* machine. On a server without a desktop, either paste an OpenAI API key instead (**Use an API key**), or forward the port to your laptop first. Click **Sign in with ChatGPT**, look at the `redirect_uri=http://127.0.0.1:<port>/…` inside the URL that opens, then on your laptop run `ssh -N -L <port>:127.0.0.1:<port> you@server` and complete the login in the browser. (This workaround is untested.)

## 9. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `systemctl status koremind` shows `bun: command not found` or `opencode server did not start` | `PATH` or `KOREMIND_OPENCODE_BIN` is wrong; the service does not read your shell profile. |
| The log says the engine "exited during startup" | OpenCode is v1, or cannot write its state. Check `opencode --version` and that `/var/lib/koremind` is owned by `koremind`. |
| Web UI opens but asks for a server address | Expected when you open it through a hostname or a different host than the backend. Enter the backend URL once. |
| Phone says it couldn't reach the server | Different network, or the firewall. Open the printed address in the phone's browser: it should show a small JSON answer at `/health`. |
| "Free usage limit reached" in chat | OpenCode's free quota is used up. Add an OpenRouter or Codex key in Settings → Providers. |
| Answers stop after a few seconds behind a proxy | The proxy is buffering the stream; see section 6. |
| The page is blank after an update | Run `bun run build` again, then restart. The web UI is a production build. |

## 10. Uninstall

```bash
sudo systemctl disable --now koremind && sudo rm /etc/systemd/system/koremind.service
sudo rm -rf /opt/koremind /etc/koremind            # keep /var/lib/koremind if you want your data
sudo userdel koremind
```
