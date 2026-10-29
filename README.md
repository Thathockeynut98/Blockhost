<div align="center">

# ⛏️ BlockHost

### Your Minecraft servers. Your hardware. Your control.

**Self-hosted Minecraft server management with Docker isolation, live performance monitoring, file management, backups, and remote-play integrations.**

![Status](https://img.shields.io/badge/status-Active%20development-f59e0b?style=for-the-badge) ![Docker](https://img.shields.io/badge/runtime-Docker-2496ed?style=for-the-badge) ![Minecraft](https://img.shields.io/badge/Minecraft-Java%20Edition-65a30d?style=for-the-badge)

</div>

> [!WARNING]
> **Development software, not a hardened public hosting panel.** BlockHost mounts the Docker socket, which grants extensive control over Docker and potentially the host. Keep the dashboard on a trusted network. **Do not publish the dashboard through an unrestricted Cloudflare Quick Tunnel.** The current email input does **not** establish a verified Cloudflare Access policy. Review [SECURITY.md](SECURITY.md).

## What is BlockHost?

BlockHost is a browser-based control panel for running and managing **multiple Minecraft Java Edition servers on your own computer or Docker host**. It provides a single place to create servers, control their containers, work with files, inspect logs, manage backups, and monitor performance. Minecraft worlds and BlockHost state use persistent Docker volumes.

**Where do servers run?** On the machine running Docker—not on a cloud service unless you deploy Docker to a cloud VM. Friends can connect using a public Minecraft address supplied by a tunnel service such as Playit.gg.

## Features at a glance

| Category | Current capabilities |
|---|---|
| **Multi-server hosting** | Separate instances, server templates, Docker containers and volumes, port allocation, CPU/RAM settings |
| **Server controls** | Start, stop, restart, kill, container status and browser console |
| **Live monitoring** | Auto-refreshing CPU/RAM, rolling performance graphs, upload/download rates, player counts, TPS and MSPT where supported |
| **Files** | Browse folders, upload/download, drag-and-drop, rename/delete, text editing and right-click actions |
| **Minecraft configuration** | Installation settings and server properties editing |
| **Backups & scheduling** | Create/restore backups and configure scheduled operations |
| **Imports** | Import existing servers from ZIP/TAR archives or select a local Windows folder in supported browsers |
| **Access & sharing** | Accounts, roles, per-instance permissions and invitation links |
| **Network & proxies** | Velocity and Waterfall options, proxy/backend configuration |
| **Remote connectivity** | Playit agent management for Minecraft; experimental Cloudflare tunnel controls for the web panel |

### Minecraft server software

The creation wizard and installer catalog include:

- **Vanilla**, **Paper**, **Spigot**, **Purpur**, **Pufferfish**, **Leaf**, **Folia**
- **Fabric**, **Forge**, **NeoForge**
- **Velocity** and **Waterfall** proxies

The version selector includes **LATEST** and listed Java Edition releases from **1.8 through 1.21.x**, including newer 1.21 releases. **Listing a version does not guarantee that a particular server distribution provides a build for it.** Verify software/version compatibility before creating a server. Older versions may need a different Java runtime; the current image configuration uses a Java 21 image and may need adjustment for legacy versions.

### Live performance dashboard

BlockHost refreshes dashboard statistics approximately **every 3 seconds** while the dashboard is visible:

- **CPU and RAM** — current container usage plus approximately five minutes of in-browser history (up to 100 samples).
- **Network** — incoming and outgoing throughput calculated from Docker's cumulative byte counters. The first reading can be zero.
- **Players** — online count and configured maximum, when Minecraft RCON responds.
- **TPS / MSPT** — tick metrics when the server software exposes compatible RCON commands; otherwise **N/A**.

History is currently **browser-session only**, not persisted to a metrics database. Monitoring is best-effort and has not been verified across every Minecraft distribution.

## Quick start

### Requirements

- Docker Desktop on Windows (with Linux containers enabled), or Docker Engine with **Compose v2**
- Enough free RAM, CPU and disk space for the Minecraft instances you intend to run
- A modern browser

### 1. Get the project

```powershell
git clone https://github.com/Thathockeynut98/Blockhost.git
cd Blockhost
```

Alternatively, download the repository ZIP and open PowerShell **inside the extracted folder containing `docker-compose.yml`**.

### 2. Build and launch

```powershell
docker compose up -d --build
```

### 3. Open the dashboard

Visit **http://localhost:8080** and create your initial account. The first registered account becomes the owner. Review and accept the Minecraft EULA before starting a server.

### 4. Create a Minecraft server

Use the server creation wizard to select a template, server software, Minecraft version, resource limits and port. Start the instance and watch the dashboard or console for startup progress. Initial installation may take time while Docker downloads the server image and Minecraft files.

> [!NOTE]
> The Minecraft server's public connection port is **not** the dashboard port. The dashboard uses **8080** by default; each Minecraft instance uses its own configured port.

## Updating an existing installation

From the directory containing your current `docker-compose.yml`:

```powershell
docker compose up -d --build --force-recreate --no-deps blockhost
```

Then hard-refresh the dashboard with **Ctrl + Shift + R**.

**Back up first.** Preserve your `/app/data` volume and each Minecraft instance volume. Compose project directory names can change the generated volume prefix: verify the volume attached to `blockhost` before moving or renaming the project folder.

```powershell
docker inspect blockhost --format '{{range .Mounts}}{{println .Name .Destination}}{{end}}'
docker volume ls --filter name=blockhost
```

> [!CAUTION]
> **Do not run `docker compose down -v`** unless you deliberately intend to delete Compose-managed volumes. Do not remove Minecraft instance volumes while troubleshooting dashboard issues.

## Connecting friends with Playit.gg

BlockHost can manage a Playit agent container, and you can also run the agent manually. Configure a **Minecraft Java TCP tunnel** in your Playit account that targets the Minecraft server's **host-published port**.

For example, if Docker maps `25566` on Windows to `25565` inside a Minecraft container, a Playit agent running in Docker Desktop can generally target:

| Playit setting | Example |
|---|---|
| Tunnel type | Minecraft Java |
| Local host | `host.docker.internal` |
| Local port | `25566` |
| Public address | The hostname assigned by Playit |

Share the **Playit Minecraft address**, not `localhost:8080`, with your friends. Confirm the actual port using `docker port <minecraft-container-name>`. Keep only one agent managing a given tunnel.

## Importing existing servers

Use the import interface to upload a supported archive or choose an existing folder. Folder selection is browser-dependent; review the transferred files and detected software before starting. Always retain a separate backup of the original world.

## Troubleshooting

| Symptom | First check |
|---|---|
| Dashboard unavailable | `docker ps` and `docker logs blockhost --tail 80` |
| Can't sign in | Verify the correct persistent volume is mounted; inspect the login API response without sharing credentials |
| Server won't start | Check the instance console, image download logs, Minecraft EULA and software/version compatibility |
| Player count or TPS shows **N/A** | Verify Minecraft is running, RCON is enabled/reachable, and the server software supports the command |
| Playit tunnel doesn't connect | `docker logs blockhost-public-playit --tail 50` and confirm the host port |
| Existing Cloudflare container name conflict | Check `docker ps -a --filter name=blockhost-public-cloudflare` before restarting it |
| Older Minecraft version fails | Check the Java runtime required by that Minecraft release and server distribution |

## Architecture

```text
Browser (localhost:8080)
          |
          v
 BlockHost control panel
   |       |         |
   |       |         +-- Account/session state + backups
   |       +------------ Live Docker telemetry + RCON
   +-------------------- Docker socket
                             |
                   +---------+----------+
                   |         |          |
                Server A  Server B    Proxy
                   |         |          |
                 Volume A  Volume B  Private network

Optional: Playit agent --> Minecraft host port --> Server
```

## Security & limitations

- The Docker socket is a privileged interface. Treat access to the BlockHost panel as **high-trust administrative access**.
- The integrated Cloudflare Quick Tunnel option should **not** be treated as email-restricted access. Configure a properly secured Cloudflare Access application or another authenticated private access solution before remote dashboard exposure.
- Protect passwords, session tokens, invitation links and Playit agent secrets; do not post them in issues or logs.
- Server software/version combinations and legacy Java runtimes are **not** universally validated.
- The monitoring dashboard currently uses periodic polling, not a persistent time-series monitoring service.
- This project is under active development; test backups and restore procedures before relying on it for important worlds.

## Project documentation

- [Security considerations](SECURITY.md)
- [Development history and provenance](HISTORY.md)
- [Contributing](CONTRIBUTING.md)
- [Original detailed product notes](docs/ORIGINAL_README.md)

---

<div align="center">

**Built for Minecraft communities that want control over their own servers.**

</div>
