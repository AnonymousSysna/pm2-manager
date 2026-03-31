param(
  [string]$TargetDir = $env:PM2_MANAGER_DIR,
  [string]$RepoUrl = $env:REPO_URL
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

Write-Host "Installing dependencies..."
npm install
npm --prefix server install
npm --prefix client install

Write-Host "Building client..."
npm run build

if (-not (Test-Path .env)) {
  Write-Host "Generating .env with random credentials..."
  Copy-Item .env.example .env

  $pm2User = "admin_$(node -e "process.stdout.write(require('crypto').randomBytes(3).toString('hex'))")"
  $pm2Pass = node -e "process.stdout.write(require('crypto').randomBytes(12).toString('base64url'))"
  $jwtSecret = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
  $metricsToken = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"

  Add-Content .env ""
  Add-Content .env "# one-tap generated credentials"
  Add-Content .env "PM2_USER=$pm2User"
  Add-Content .env "PM2_PASS=$pm2Pass"
  Add-Content .env "JWT_SECRET=$jwtSecret"
  Add-Content .env "METRICS_TOKEN=$metricsToken"
  Add-Content .env "CORS_ALLOWED_ORIGINS=http://localhost:8000"

  Write-Host "Created .env"
  Write-Host "Login user: $pm2User"
  Write-Host "Login pass: $pm2Pass"
}

npm --prefix server exec pm2 -- describe pm2-dashboard *> $null
if ($LASTEXITCODE -eq 0) {
  Write-Host "Restarting existing pm2-dashboard..."
  npm run pm2:restart
} else {
  Write-Host "Starting pm2-dashboard..."
  npm run pm2:start
}

Write-Host "Done. Open http://localhost:8000"
npm run pm2:logs
