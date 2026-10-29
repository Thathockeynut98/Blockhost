<div align="center">

# ⛏️ BlockHost

### Self-hosted Minecraft server management, built for control.

**Multi-server hosting · Docker isolation · Backups · Server imports · Browser dashboard**

![Release](https://img.shields.io/badge/release-v6.2-22c55e?style=for-the-badge) ![Platform](https://img.shields.io/badge/platform-Docker%20%7C%20Windows-2563eb?style=for-the-badge) ![Status](https://img.shields.io/badge/status-Development-f59e0b?style=for-the-badge)

</div>

> [!IMPORTANT]
> **Development build:** This project has not been independently security-audited. Docker socket access grants extensive control over the host. Keep the dashboard on a trusted network behind appropriate access controls.

## Overview

BlockHost is a self-hosted control panel for managing multiple Minecraft servers. Create isolated instances, manage their files and consoles, configure server resources, schedule backups, and import existing Minecraft worlds and servers from archives or a Windows folder.

## Features

| Area | Capabilities |
|---|---|
| Server management | Multiple instances, templates, allocated ports, memory/CPU limits |
| Minecraft software | Paper, Vanilla, Fabric, Forge, NeoForge, Velocity, and legacy options |
| Operations | Browser console, file manager, live container metrics, scheduled backups |
| Access | Accounts, roles, instance permissions, invite links |
| Imports | ZIP/TAR/TAR.GZ/TGZ archives and **direct Windows folder selection** |
| Infrastructure | Docker-based instance isolation, persistent volumes, private proxy networking |

## Quick start

**Prerequisites:** Docker Desktop or Docker Engine with Compose v2.

```bash
git clone https://github.com/YOUR-USERNAME/BlockHost.git
cd BlockHost
docker compose up -d --build
```

Open **http://localhost:8080** and create the first account. The first account is assigned the owner role. Only accept the Minecraft EULA when you have reviewed and agreed to it.

> [!CAUTION]
> The included configuration mounts the Docker socket. **Do not publish this dashboard directly to the internet.** Use HTTPS, network restrictions, and secure credentials before wider deployment.

## Import an existing server

From **Import server**, choose either an archive or **Existing folder**. On Windows, select the Minecraft server directory in the browser picker; BlockHost transfers the folder structure without requiring ZIP/TAR packaging. Review detected software, ports, resources, and EULA status before starting the imported server.

## Architecture

```text
Browser dashboard
       │
BlockHost control plane ── Docker Engine
       │                     ├── Minecraft server A + volume
       │                     ├── Minecraft server B + volume
       │                     └── Proxy + private network
       └── Auth / files / backups / metrics
```

## Release evolution

| Snapshot | Milestone |
|---|---|
| v1 | Initial Minecraft hosting panel |
| v2 | Expanded hosting capabilities |
| v3 | Automated Minecraft setup |
| v4 | Broader hosting platform |
| v5 | Multi-server platform |
| v6 | Container-oriented self-hosted platform |
| v6.1 | Import existing servers from archives |
| **v6.2** | **Import existing Windows folders directly** |

The version tags are **reconstructed from preserved release ZIPs**, not the original development commits. See [HISTORY.md](HISTORY.md) for provenance.

## Documentation

- [Development history and provenance](HISTORY.md)
- [Security considerations](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Original detailed product notes](docs/ORIGINAL_README.md)

## Project status

BlockHost is an evolving project. Test upgrades, backups, restores, and imports in a safe environment before relying on it for production servers.
