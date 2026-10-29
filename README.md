# BlockHost v4

A self-hosted Minecraft server control panel for friends.

## What's new
- Paper, Spigot, Fabric, Forge, NeoForge
- Velocity and Waterfall proxy installation
- Real automatic server JAR/installer downloads
- Automatic Minecraft/server software detection
- Modrinth search + one-click downloads
- Optional CurseForge API integration + one-click downloads
- Java 17/21 detection and automatic Java selection
- Real host/container CPU, RAM, disk and network metrics
- Local user accounts with password hashing and sessions
- Roles: owner/admin/member
- Public Invite Friends links with expiry and use limits
- Per-user server access controls
- Existing console/files/players/backups controls retained

## Run
1. Install Docker Desktop.
2. Extract this project.
3. From the project folder:
   `docker compose up -d --build`
4. Open http://localhost:8080
5. The first account created becomes the owner.

## CurseForge
CurseForge's API requires an API key. Set:
`CURSEFORGE_API_KEY=your_key`
in a `.env` file next to docker-compose.yml, then rebuild/restart.

## Important
This is a self-hosted beta. Put it behind HTTPS/reverse proxy before exposing it to the public internet. Do not publish your CurseForge key. Minecraft EULA acceptance remains the operator's responsibility.

The Modrinth integration uses their public API and downloads the selected version file. Their API documents version filtering by Minecraft version and loader. Paper/Velocity/Waterfall downloads use PaperMC's downloads service. Forge and NeoForge use their official installers. See the project documentation for the upstream services.

## Multi-server instances
BlockHost v5 introduces independent instances. Each instance has:
- its own directory under `servers/<instance-id>`
- its own port
- RAM allocation
- software/version
- files, mods/plugins and backups
- player/activity data
- per-instance access permissions

Built-in examples are intended to be created as `Survival`, `Creative`, `Modded`, and `Proxy`, but you can create arbitrary server types.

The owner/admin can create, edit and delete instances. Members only see instances explicitly granted to them.
