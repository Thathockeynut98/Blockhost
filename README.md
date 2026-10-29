# BlockHost v6 — Self-Hosted Minecraft Hosting Platform

BlockHost v6 turns the multi-server dashboard into a container-oriented hosting control plane.

## Included
- Per-instance Docker container isolation using `itzg/minecraft-server` and `itzg/mc-proxy`
- Per-instance CPU and RAM limits enforced by Docker
- Automatic public port allocation and collision checks
- Survival, Creative, Modded, Proxy and Vanilla templates
- Four-step server creation wizard with explicit EULA acceptance
- Paper, Fabric, Forge, NeoForge, Vanilla, Velocity and Waterfall runtime selection
- Persistent per-instance Docker volumes
- Automatic backup and restart schedules
- Backup download, restore and deletion
- Proxy-to-backend private Docker networking
- Velocity backend configuration generation
- Authentication, owner/admin/member roles and per-instance access
- Public invite links with expiry, use limits and permissions
- Container console through Docker logs + RCON
- File browser/editor/upload/folder/rename/delete via the instance volume
- Live Docker container resource metrics

## Architecture
BlockHost itself is the control plane. Each Minecraft server is an independent container attached to `blockhost-net`, with its own volume and Docker resource limits. This keeps crashes, JVM memory pressure and server files isolated from the panel and from other instances.

The panel needs access to `/var/run/docker.sock` to create and manage server containers. **Treat the BlockHost panel as a trusted administrator application** and do not expose it directly to an untrusted network without HTTPS, strong authentication, backups and host-level hardening.

## Start
```bash
docker compose up -d --build
```
Then open `http://localhost:8080` and create the first account.

The first account becomes `owner`.

## Docker requirements
- Docker Engine / Docker Desktop with Compose v2
- The BlockHost container must be allowed to access the Docker socket.
- Internet access is required when an instance first starts so the selected Minecraft/proxy image can download its runtime.

## Important
Minecraft EULA acceptance is intentionally explicit in the creation wizard. BlockHost does not silently accept it for you.

The proxy integration uses `itzg/mc-proxy` and connects backend instances through the private Docker network. Velocity is the recommended proxy for new networks; Waterfall support is retained for compatibility.

## Importing an existing Minecraft server

From the dashboard choose **Import server** and upload a `.zip`, `.tar`, `.tar.gz`, or `.tgz` containing an existing server directory. BlockHost:

- extracts the archive safely into a new isolated Docker volume
- detects common server software (Vanilla, Paper, Spigot, Fabric, Forge, NeoForge, Velocity, Waterfall)
- preserves worlds, `server.properties`, plugins, mods, configs and other files
- reads the existing server port when available, otherwise allocates a free port
- lets you choose RAM, CPU, port and max players
- requires EULA confirmation when the imported server does not already contain `eula=true`
- runs the imported server in its own BlockHost Docker container

For large worlds, keep the browser open until the import completes. The current import upload limit is 8 GB.

## Importing an existing Windows server folder

The Import Server workflow can now import a Minecraft server directly from an existing folder on Windows. You no longer need to create a ZIP or TAR archive first.

In the BlockHost web panel:

1. Select **Import server**.
2. Choose **Existing folder** as the source type.
3. Select the existing Minecraft server folder in the Windows folder picker.
4. BlockHost uploads the folder contents while preserving the relative directory structure.
5. BlockHost detects the server software, reads `server.properties`, checks `eula.txt`, allocates a port, and copies the server into its isolated Docker volume.

The archive import option remains available for ZIP, TAR, TAR.GZ, and TGZ files.
