param([switch]$Check)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$installation = Get-Content -Raw -LiteralPath (Join-Path $root 'installation.json') | ConvertFrom-Json
if ([DateTimeOffset]::Parse($installation.expiresAt) -le [DateTimeOffset]::UtcNow) { throw 'Host credential expired. Create and install a fresh pairing file in the app.' }
$secureToken = (Get-Content -Raw -LiteralPath (Join-Path $root 'credential.dpapi')).Trim() | ConvertTo-SecureString
try {
    $env:NCTRACKS_HOST_TOKEN = [Net.NetworkCredential]::new('', $secureToken).Password
    Set-Location -LiteralPath $installation.appRoot
    $mode = if ($Check) { '--check' } else { '--run' }
    & $installation.nodeExecutable (Join-Path $installation.appRoot 'node_modules\tsx\dist\cli.mjs') (Join-Path $installation.appRoot 'scripts\nctracks-host\cli.ts') --config (Join-Path $root 'config.json') $mode
    exit $LASTEXITCODE
} finally { Remove-Item Env:NCTRACKS_HOST_TOKEN -ErrorAction SilentlyContinue; $secureToken.Dispose() }
