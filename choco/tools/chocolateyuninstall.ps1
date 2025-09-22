$ErrorActionPreference = 'Stop'

$packageName  = 'rclone-ui'
$displayName  = 'Rclone UI*'  

$uninstKeys = Get-UninstallRegistryKey -SoftwareName $displayName
if (-not $uninstKeys -or $uninstKeys.Count -eq 0) {
  Write-Warning "No uninstall entry found for $displayName"
  return
}

$uninstString = $uninstKeys[0].UninstallString

Uninstall-ChocolateyPackage -PackageName $packageName -FileType 'exe' -SilentArgs '/S' -File $uninstString
