$ErrorActionPreference = 'Stop'

$packageName = 'rclone-ui'
$toolsDir    = Split-Path -Parent $MyInvocation.MyCommand.Definition

$url_x64     = 'x64'
$sha_x64     = 'x64'
$url_arm64   = 'arm64'
$sha_arm64   = 'arm64'

$silentArgs = '/S /AllUsers'

$arch   = (Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Architecture)
$isArm  = $arch -eq 12   # 12 = ARM64, 9 = x64
$url    = $isArm ? $url_arm64 : $url_x64
$sha    = $isArm ? $sha_arm64 : $sha_x64

$packageArgs = @{
  packageName    = $packageName
  fileType       = 'exe'
  url64bit       = $url
  checksum64     = $sha
  checksumType64 = 'sha256'
  silentArgs     = $silentArgs
  validExitCodes = @(0)
}

Install-ChocolateyPackage @packageArgs
