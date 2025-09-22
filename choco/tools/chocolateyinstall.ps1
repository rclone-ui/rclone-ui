$ErrorActionPreference = 'Stop'

$packageName = 'rclone-ui'
$toolsDir    = Split-Path -Parent $MyInvocation.MyCommand.Definition

$url_x64     = 'x64'
$sha_x64     = 'x64'
$url_arm64   = 'arm64'
$sha_arm64   = 'arm64'

$repo        = 'rclone-ui/rclone-ui'
$pkgVersion  = $env:ChocolateyPackageVersion
if (-not $pkgVersion) { $pkgVersion = $env:chocolateyPackageVersion }
$base        = if ($pkgVersion) { "https://github.com/$repo/releases/download/v$pkgVersion" } else { $null }
$defaultUrlX64   = if ($base) { "$base/Rclone.UI_x64.exe" } else { $null }
$defaultUrlArm64 = if ($base) { "$base/Rclone.UI_arm64.exe" } else { $null }

$arch   = (Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Architecture)
$isArm  = $arch -eq 12
if ($isArm) {
  $url = $url_arm64
  $sha = $sha_arm64
} else {
  $url = $url_x64
  $sha = $sha_x64
}

if (-not ($url -match '^https?://')) {
  if ($isArm -and $defaultUrlArm64) {
    $url = $defaultUrlArm64
  } elseif ($defaultUrlX64) {
    $url = $defaultUrlX64
  }
}

$packageArgs = @{
  packageName    = $packageName
  fileType       = 'exe'
  url64bit       = $url
  silentArgs     = '/S /AllUsers'
  validExitCodes = @(0)
}

if ($sha -match '^[0-9A-Fa-f]{64}$') {
  $packageArgs['checksum64']     = $sha
  $packageArgs['checksumType64'] = 'sha256'
}

Install-ChocolateyPackage @packageArgs
