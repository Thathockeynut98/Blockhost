# Smart Start (Windows)

Use `Start-BlockHost.ps1` to start or update BlockHost without unnecessarily rebuilding its Docker image.

## Run

In the extracted BlockHost folder, right-click `Start-BlockHost.ps1` and choose **Run with PowerShell**, or open PowerShell in the folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\Start-BlockHost.ps1
```

To force a rebuild after downloading updated source code:

```powershell
powershell -ExecutionPolicy Bypass -File .\Start-BlockHost.ps1 -ForceBuild
```

To check Docker for newer base images during a rebuild:

```powershell
powershell -ExecutionPolicy Bypass -File .\Start-BlockHost.ps1 -ForceBuild -PullBaseImages
```

## How it works

- Checks Docker Desktop and Docker Compose.
- Detects an existing BlockHost container and lists detected Minecraft containers.
- Computes a SHA-256 fingerprint of the application build inputs.
- Reuses the existing image when no changes are detected; builds only when needed.
- Uses `docker compose up -d` to reconcile the BlockHost service.
- Does not delete volumes, stop existing Minecraft containers, or download Minecraft server images.
- Stores the previous fingerprint in `.blockhost-local/source.sha256` (a local-only file).

**Important:** The first run intentionally reuses an already installed BlockHost image when present, because there is no prior fingerprint to compare. If you just downloaded new source, use `-ForceBuild` once.

Docker may still download missing base layers or the Minecraft image when you create a *new* Minecraft server. Existing images are normally cached. This script doesn't alter or import Minecraft containers; use BlockHost's import feature for that.

Do not expose the BlockHost dashboard publicly; its Docker socket mount grants powerful access to your Docker host.
