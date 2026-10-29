# BlockHost Smart Start / Update (Windows PowerShell 5.1+)
# Run from any folder: powershell -ExecutionPolicy Bypass -File .\Start-BlockHost.ps1
[CmdletBinding()]
param([switch]$ForceBuild,[switch]$NoBrowser,[switch]$PullBaseImages)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$stateDir = Join-Path $PSScriptRoot ".blockhost-local"
$hashFile = Join-Path $stateDir "source.sha256"
function Say($message) { Write-Host "[BlockHost] $message" -ForegroundColor Cyan }
function Warn($message) { Write-Host "[BlockHost] $message" -ForegroundColor Yellow }
function Fail($message) { Write-Host "[BlockHost] ERROR: $message" -ForegroundColor Red; exit 1 }
function DockerText([string[]]$arguments) {
    $out = & docker @arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw ("Docker command failed: docker " + ($arguments -join " ") + " - " + ($out -join " ")) }
    return ($out -join "`n").Trim()
}
function Compose([string[]]$arguments) {
    & docker compose @arguments
    if ($LASTEXITCODE -ne 0) { throw "docker compose failed (exit $LASTEXITCODE)" }
}
try {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail "Docker Desktop is not installed or docker is not on PATH." }
    Say "Checking Docker engine..."
    try { $null = DockerText @("info","--format","{{.ServerVersion}}") }
    catch { Fail "Docker engine is not available. Start Docker Desktop, wait for Engine running, and retry." }
    & docker compose version | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "Docker Compose plugin is unavailable." }
    if (-not (Test-Path "docker-compose.yml")) { Fail "docker-compose.yml was not found in $PSScriptRoot" }

    # Fingerprint only build inputs, excluding local state, downloads and server data.
    $inputs = @("Dockerfile","docker-compose.yml","package.json","package-lock.json","server.js","settings-schema.js")
    foreach ($dir in @("public")) {
        if (Test-Path $dir) {
            $inputs += @(Get-ChildItem $dir -Recurse -File | ForEach-Object { $_.FullName.Substring($PSScriptRoot.Length + 1) })
        }
    }
    $inputs = @($inputs | Where-Object { Test-Path $_ } | Sort-Object -Unique)
    $hashes = foreach ($file in $inputs) {
        $item = Get-Item $file
        "$($file.Replace('\\','/')):$((Get-FileHash -Algorithm SHA256 -LiteralPath $item.FullName).Hash)"
    }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes(($hashes -join "`n"))
        $fingerprint = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace("-","").ToLowerInvariant()
    } finally { $sha.Dispose() }
    $previous = if (Test-Path $hashFile) { (Get-Content $hashFile -Raw).Trim() } else { "" }

    $containerExists = $false
    $containerRunning = $false
    $containerImage = ""
    try {
        $existing = DockerText @("inspect","blockhost","--format","{{.State.Running}}|{{.Image}}")
        $containerExists = $true
        $parts = $existing -split "\|",2
        $containerRunning = $parts[0] -eq "true"
        $containerImage = if ($parts.Count -gt 1) { $parts[1] } else { "" }
    } catch {}
    $imageAvailable = $false
    if ($containerImage) {
        try { $null = DockerText @("image","inspect",$containerImage,"--format","{{.Id}}"); $imageAvailable = $true } catch {}
    }
    Say ("BlockHost container: " + $(if($containerExists){if($containerRunning){"running"}else{"stopped"}}else{"not found"}))
    $mc = @(& docker ps -a --format "{{.Names}}|{{.Image}}|{{.Status}}" 2>$null |
        Where-Object { $_ -match "itzg/minecraft-server|itzg/minecraft-bedrock-server|^blockhost-[^|]+\|" })
    if ($mc.Count) {
        Say "Existing Minecraft Docker containers (not modified):"
        foreach ($row in $mc) { Write-Host "  $row" }
    } else { Say "No existing Minecraft Docker containers detected." }

    $needsBuild = $ForceBuild -or (-not $containerExists) -or (-not $imageAvailable) -or ($previous -ne $fingerprint)
    # On first use, an existing container may already be valid. Avoid rebuilding unless
    # we can prove a change, but save the current fingerprint for subsequent launches.
    if ($containerExists -and $imageAvailable -and -not $previous -and -not $ForceBuild) {
        $needsBuild = $false
        Warn "First smart run: reusing existing BlockHost image. Use -ForceBuild if you just updated source files."
    }
    if ($needsBuild) {
        Say "Source changed or image missing. Building BlockHost (Docker cache will be reused)..."
        if ($PullBaseImages) { Compose @("build","--pull","blockhost") }
        else { Compose @("build","blockhost") }
        Compose @("up","-d","--no-build","blockhost")
    } else {
        Say "Existing image is reusable. Starting/reconciling BlockHost without downloading or rebuilding..."
        Compose @("up","-d","--no-build","blockhost")
    }
    if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
    Set-Content -Path $hashFile -Value $fingerprint -Encoding ascii
    Say "Dashboard: http://localhost:8080"
    Say "Existing Minecraft containers and Docker volumes have been preserved."
    & docker compose ps
    if (-not $NoBrowser) { Start-Process "http://localhost:8080" }
} catch { Fail $_.Exception.Message }
