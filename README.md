# BlockHost — Minecraft Server Hoster

A self-hosted Minecraft server control panel starter.

## What it includes
- Start / stop / restart the Java server
- Live console + command input
- Server health dashboard
- Player list
- Server file browser/editor
- Responsive dark UI
- Docker deployment
- Persistent `servers/main` directory

## Run it

1. Install Docker Desktop.
2. Put a Minecraft Java server JAR at:
   `servers/main/server.jar`
3. Create `servers/main/eula.txt` containing:
   `eula=true`
4. From this folder run:
   `docker compose up -d --build`
5. Open:
   `http://localhost:8080`

Minecraft server software and the EULA are not bundled. Use a server JAR you are permitted to use.

## Let friends connect

On your home network, forward TCP port `25565` from your router to the computer running Docker. Then give friends your public IP or a DNS hostname.

For a safer internet-facing deployment, put the dashboard behind authentication/HTTPS and do not expose the dashboard port directly.

## Next production upgrades
- Accounts + 2FA
- Multiple servers
- Real CPU/RAM metrics from the host
- Minecraft query/RCON integration for accurate TPS/player data
- File upload/download
- Backups and restore
- Server version/modpack installer
- Per-user permissions
- Automatic port allocation
- HTTPS/reverse proxy
- Audit log
