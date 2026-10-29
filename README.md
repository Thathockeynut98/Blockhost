# BlockHost v3 — Automatic Server Setup

## New
- Automatic setup UI for Paper, Spigot, Fabric, Forge and NeoForge.
- Minecraft version selection.
- One-click catalog addons for common plugins/mods.
- Installation progress and live installer logs.
- Paper and Spigot installation are wired to official/public project APIs/build tooling.
- Fabric installation uses Fabric's metadata service.
- Forge/NeoForge are represented in the installer catalog, with production-grade pinned-build installers intentionally left as the next integration because build URLs must be matched to the selected Minecraft version.

## Run
1. Install Docker Desktop.
2. Put this project in a folder.
3. Put a server JAR in `servers/main/server.jar` only if you want to keep an existing server; the setup page can replace it for supported installers.
4. Run `docker compose up -d --build`.
5. Open `http://localhost:8080`.
6. Open **Server Setup**.
7. Select software + Minecraft version.
8. Click **Install / Switch Server**.

## Safety
Stop the server before switching software. Back up the world before changing loaders or major versions.

Do not expose the dashboard publicly without authentication, HTTPS, CSRF protection, rate limiting, and authorization.

## Next production step
Use pinned official Forge/NeoForge installer coordinates, Modrinth/CurseForge APIs, compatibility checks, server-type detection, multiple server instances, authentication, and per-server isolation.
