# ⛏️ BlockHost

### Self-hosted Minecraft server management, built for control.

**Multi-server hosting · Docker isolation · Backups · Server imports · Browser dashboard**

![Release](https://img.shields.io/badge/release-v6.2-22c55e?style=for-the-badge) ![Platform](https://img.shields.io/badge/platform-Docker%20%7C%20Windows-2563eb?style=for-the-badge) ![Status](https://img.shields.io/badge/status-Development-f59e0b?style=for-the-badge)

> [!IMPORTANT]
> **Development build:** BlockHost has not been independently security-audited. Docker socket access provides broad host-level privileges. Use a trusted network and appropriate access controls.

## Overview

BlockHost is a self-hosted control panel for managing Minecraft servers, with a focus on multiple isolated instances, server consoles, file management, backup workflows and importing existing Minecraft servers.

## Feature areas

| Area | Scope |
|---|---|
| Server management | Multiple instances, templates, ports and resources |
| Minecraft software | Paper, Vanilla, Fabric, Forge, NeoForge and proxy software |
| Operations | Browser console, files, metrics and backups |
| Accounts | Roles and permissions |
| Imports | ZIP, TAR, TAR.GZ and direct Windows folder import |
| Infrastructure | Docker-based isolation and persistent volumes |

## Development milestones

| Version | Focus |
|---|---|
| v1 | Initial hosting panel |
| v2 | Expanded host functionality |
| v3 | Automated setup |
| v4 | Hosting platform |
| v5 | Multi-server management |
| v6 | Self-hosted Docker platform |
| v6.1 | Import existing servers |
| v6.2 | Direct Windows folder imports |

**History note:** The prepared local Git history was reconstructed from preserved release archives; it is not the original development history. The source-code history has not yet been pushed to this remote repository.

## Quick start (after source upload)

```bash
git clone https://github.com/Thathockeynut98/Blockhost.git
cd Blockhost
docker compose up -d --build
```

> [!CAUTION]
> Never expose a Docker-socket-enabled management dashboard directly to the public internet.

## Documentation

- [Development history](HISTORY.md)
- [Security guidance](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## Project status

**Under active development.** Test carefully before production use.
