param(
  [string]$Version = '',
  [switch]$SkipWorkPet
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Write-Utf8NoBom {
  param([string]$Path, [string]$Text)
  [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}

$rootVersion = (Get-Content (Join-Path $repoRoot 'package.json') -Raw -Encoding utf8 | ConvertFrom-Json).version
$workpetVersion = (Get-Content (Join-Path $repoRoot 'apps\workpet\package.json') -Raw -Encoding utf8 | ConvertFrom-Json).version
if (-not $Version) { $Version = $rootVersion }
if ($Version -notmatch '^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$') {
  throw "Invalid release version: $Version"
}
if ($Version -ne $rootVersion -or $Version -ne $workpetVersion) {
  throw "Release version $Version does not match root=$rootVersion and WorkPet=$workpetVersion."
}
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'Windows release artifacts must be built on Windows.'
}

$releaseRoot = Join-Path $repoRoot 'dist\release\windows'
$portableRoot = Join-Path $releaseRoot "WorkPanelConnecter_$($Version)_win-x64"
$artifactRoot = Join-Path $releaseRoot 'artifacts'
$packagerRoot = Join-Path $repoRoot 'tools\windows-packager'
$packagerBin = Join-Path $packagerRoot 'node_modules\.bin'
$bundleFile = Join-Path $releaseRoot 'connecter-relay.cjs'
$seaBlob = Join-Path $releaseRoot 'connecter-relay.blob'
$seaConfig = Join-Path $releaseRoot 'sea-config.json'
$connecterExe = Join-Path $portableRoot 'WorkPanelConnecter.exe'

if (Test-Path $releaseRoot) {
  $resolved = [IO.Path]::GetFullPath($releaseRoot)
  $expected = [IO.Path]::GetFullPath((Join-Path $repoRoot 'dist\release'))
  if (-not $resolved.StartsWith($expected, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean unexpected release path: $resolved"
  }
  Remove-Item -LiteralPath $releaseRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $portableRoot, $artifactRoot | Out-Null

if (-not (Test-Path (Join-Path $packagerBin 'esbuild.cmd'))) {
  & npm.cmd ci --prefix $packagerRoot --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Failed to install Windows packager dependencies.' }
}

& (Join-Path $packagerBin 'esbuild.cmd') `
  (Join-Path $repoRoot 'bin\connecter-relay.js') `
  --bundle `
  --platform=node `
  --format=cjs `
  --target=node24 `
  --define:CONNECTER_PACKAGED=true `
  --log-override:empty-import-meta=silent `
  --outfile=$bundleFile
if ($LASTEXITCODE -ne 0) { throw 'esbuild failed.' }

$seaConfigText = @{
  main = $bundleFile
  output = $seaBlob
  disableExperimentalSEAWarning = $true
} | ConvertTo-Json
Write-Utf8NoBom -Path $seaConfig -Text $seaConfigText

& node.exe --experimental-sea-config $seaConfig
if ($LASTEXITCODE -ne 0) { throw 'Node SEA blob generation failed.' }

Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination $connecterExe

$signTool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if (-not $signTool) {
  $kits = @(
    'C:\Program Files (x86)\Windows Kits\10\bin',
    'C:\Program Files\Windows Kits\10\bin'
  )
  foreach ($kit in $kits) {
    if (Test-Path $kit) {
      $signTool = Get-ChildItem -Path $kit -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending |
        Select-Object -First 1
      if ($signTool) { break }
    }
  }
}
if ($signTool) {
  & $signTool.FullName remove /s $connecterExe | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Failed to remove the copied Node executable signature.' }
}

& (Join-Path $packagerBin 'postject.cmd') `
  $connecterExe `
  NODE_SEA_BLOB `
  $seaBlob `
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if ($LASTEXITCODE -ne 0) { throw 'Failed to inject the SEA blob.' }

$relayResources = Join-Path $portableRoot 'resources\relay'
New-Item -ItemType Directory -Path $relayResources | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot 'src\relay\schema.sql') -Destination $relayResources
Copy-Item -LiteralPath (Join-Path $repoRoot 'src\relay\migrations') -Destination $relayResources -Recurse

$configDir = Join-Path $portableRoot 'config'
New-Item -ItemType Directory -Path $configDir | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot 'config\relay.example.json') -Destination $configDir
Copy-Item -LiteralPath (Join-Path $repoRoot 'config\relay.schema.json') -Destination $configDir
Copy-Item -LiteralPath (Join-Path $repoRoot 'packaging\windows\README.txt') -Destination $portableRoot

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$smokePort = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()
$smokeDir = Join-Path $releaseRoot 'smoke'
New-Item -ItemType Directory -Path $smokeDir | Out-Null
$smokeConfig = Join-Path $smokeDir 'relay.json'
$smokeDb = Join-Path $smokeDir 'connector.db'
$smokeLog = Join-Path $smokeDir 'stdout.log'
$smokeError = Join-Path $smokeDir 'stderr.log'
$smokeConfigText = @{
  listen = @{ host = '127.0.0.1'; port = $smokePort }
  publicBaseUrl = "http://127.0.0.1:$smokePort"
  db = @{ path = $smokeDb }
  auth = @{ tokens = @('windows-package-smoke-token') }
  backends = @{}
  defaults = @{ env = 'canary'; group = 'smoke' }
  host = @{ role = 'standalone'; siteId = 'windows-package-smoke' }
  runners = @()
  pets = @()
} | ConvertTo-Json -Depth 8
Write-Utf8NoBom -Path $smokeConfig -Text $smokeConfigText

$oldConfig = $env:CONNECTER_RELAY_CONFIG
$oldHost = $env:CONNECTER_RELAY_HOST
$oldPort = $env:CONNECTER_RELAY_PORT
$process = $null
try {
  $env:CONNECTER_RELAY_CONFIG = $smokeConfig
  $env:CONNECTER_RELAY_HOST = '127.0.0.1'
  $env:CONNECTER_RELAY_PORT = [string]$smokePort
  $process = Start-Process -FilePath $connecterExe -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $smokeLog -RedirectStandardError $smokeError
  $healthy = $false
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    if ($process.HasExited) { break }
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$smokePort/v1/health" -TimeoutSec 1
      if ($health.ok -eq $true) {
        $healthy = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $healthy) {
    $details = if (Test-Path $smokeError) { Get-Content $smokeError -Raw } else { 'no stderr' }
    throw "Packaged Connecter health smoke failed: $details"
  }
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
    $process.WaitForExit()
  }
  $env:CONNECTER_RELAY_CONFIG = $oldConfig
  $env:CONNECTER_RELAY_HOST = $oldHost
  $env:CONNECTER_RELAY_PORT = $oldPort
}

$portableZip = Join-Path $artifactRoot "WorkPanelConnecter_$($Version)_win-x64-portable.zip"
Compress-Archive -LiteralPath $portableRoot -DestinationPath $portableZip -CompressionLevel Optimal

if (-not $SkipWorkPet) {
  $workpetRoot = Join-Path $repoRoot 'apps\workpet'
  & npm.cmd ci --prefix $workpetRoot --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'WorkPet npm ci failed.' }
  Push-Location $workpetRoot
  try {
    & npm.cmd run build -- --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw 'WorkPet NSIS build failed.' }
  } finally {
    Pop-Location
  }
  $workpetInstaller = Join-Path $workpetRoot "src-tauri\target\release\bundle\nsis\WorkPet_$($Version)_x64-setup.exe"
  if (-not (Test-Path $workpetInstaller)) {
    throw "WorkPet installer not found: $workpetInstaller"
  }
  Copy-Item -LiteralPath $workpetInstaller -Destination $artifactRoot
}

$hashFile = Join-Path $artifactRoot 'SHA256SUMS.txt'
$hashLines = Get-ChildItem -LiteralPath $artifactRoot -File |
  Where-Object Name -ne 'SHA256SUMS.txt' |
  Sort-Object Name |
  ForEach-Object {
    $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $($_.Name)"
  }
$hashLines | Set-Content -LiteralPath $hashFile -Encoding ascii

Write-Output "WINDOWS_RELEASE_BUILD_OK version=$Version"
Get-ChildItem -LiteralPath $artifactRoot -File | Select-Object Name, Length, FullName
