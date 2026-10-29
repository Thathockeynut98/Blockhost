# BlockHost v2

A self-hosted Minecraft server management panel for friends/community servers.

## Included
Dashboard, live TPS/CPU/RAM/disk/network metrics, uptime, players, version, start/stop/restart/kill controls, live console, command execution, file manager, upload/download/delete/create folders, editor, player moderation commands, activity log, backups/restore/download/delete, scheduled-backup settings, mod/plugin library, and server.properties editor.

## Start
1. Install Docker Desktop.
2. Put a Java Minecraft server JAR at `servers/main/server.jar`.
3. Put `eula=true` in `servers/main/eula.txt`.
4. Run `docker compose up -d --build`.
5. Open `http://localhost:8080`.

## Important
This project does not bundle Minecraft server software. Use a server JAR and mods/plugins you are licensed/permitted to use.

The panel should not be exposed directly to the public internet without authentication, HTTPS, and access controls. v2 is a strong local/LAN foundation.

## Production roadmap
- Authentication + sessions + 2FA
- Real host-level metrics
- RCON/query integration for exact TPS/player UUIDs
- Modrinth/CurseForge integration with version compatibility checks
- Per-server isolation and multiple server instances
- Scheduled jobs worker
- Automatic server.jar version management
- Reverse proxy/HTTPS
- Audit log and role-based permissions
