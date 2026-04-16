param(
  [string]$TargetDir = $env:PM2_MANAGER_DIR,
  [string]$RepoUrl = $env:REPO_URL,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$InstallerArgs
)

$ErrorActionPreference = "Stop"

if (-not $RepoUrl) {
  $RepoUrl = "https://github.com/AnonymousSysna/pm2-manager.git"
}
if (-not $TargetDir) {
  $TargetDir = Join-Path $HOME "pm2-manager"
}

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

Require-Command git
Require-Command node
Require-Command npm

$rootPackage = Join-Path (Get-Location) "package.json"
if ((Test-Path $rootPackage) -and ((Get-Content $rootPackage -Raw) -match '"name"\s*:\s*"pm2-dashboard"')) {
  $appDir = (Get-Location).Path
} else {
  $appDir = $TargetDir
  if (Test-Path (Join-Path $appDir ".git")) {
    git -C $appDir pull --ff-only
  } elseif (Test-Path $appDir) {
    $hasFiles = (Get-ChildItem -Force $appDir | Measure-Object).Count -gt 0
    if ($hasFiles) {
      throw "Target directory exists and is not empty: $appDir"
    }
    git clone $RepoUrl $appDir
  } else {
    git clone $RepoUrl $appDir
  }
  Set-Location $appDir
}

$forwarded = @("--app-dir", $appDir)
if ($InstallerArgs) {
  $forwarded += $InstallerArgs
}

& node (Join-Path $appDir "scripts\onetap.js") @forwarded
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
