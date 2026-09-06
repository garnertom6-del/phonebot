param(
    [Parameter(Mandatory = $true)][string]$PairingFile,
    [Parameter(Mandatory = $true)][string]$CodexExecutable,
    [string]$ExpectedAppUrl = 'https://mdc-smart-intake.onrender.com'
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This installer requires Windows DPAPI.' }
$appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$downloads = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Downloads'))
$pairingPath = (Resolve-Path -LiteralPath $PairingFile).Path
if ([IO.Path]::GetDirectoryName($pairingPath) -ne $downloads -or [IO.Path]::GetFileName($pairingPath) -notmatch '^NCTracks-workstation-pairing-[a-f0-9-]+\.json$') { throw 'Use the app pairing file saved directly in Downloads.' }
$pairing = Get-Content -Raw -LiteralPath $pairingPath | ConvertFrom-Json
if ($pairing.protocolVersion -ne 1 -or $pairing.appUrl -ne $ExpectedAppUrl -or $pairing.authorizedNpi -ne '1134943608' -or $pairing.hostId -notmatch '^[a-f0-9-]{36}$' -or $pairing.hostToken -notmatch '^[A-Za-z0-9_-]{64}$' -or -not $pairing.providerId -or [DateTimeOffset]::Parse($pairing.expiresAt) -le [DateTimeOffset]::UtcNow) { throw 'Pairing file does not match the expected application, provider rule or credential format.' }
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
$codexPath = (Resolve-Path -LiteralPath $CodexExecutable).Path
if ([IO.Path]::GetFileName($codexPath) -ne 'codex.exe') { throw 'Select the installed Codex executable.' }
$tsxPath = Join-Path $appRoot 'node_modules\tsx\dist\cli.mjs'
if (-not (Test-Path -LiteralPath $tsxPath)) { throw 'Run npm ci in smart-intake before installing the bridge.' }
$root = Join-Path $env:LOCALAPPDATA 'Welliance\NCTracksHost'
New-Item -ItemType Directory -Path $root -Force | Out-Null
$artifactRoot = Join-Path $downloads 'NC Tracks Cards'
New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
if (Test-Path -LiteralPath (Join-Path $artifactRoot '.nctracks-host.lock')) { throw 'An existing bridge lock must be resolved before replacing its configuration.' }
$config = @{
    appUrl = $ExpectedAppUrl; artifactRoot = $artifactRoot
    runner = @{ executable = $nodeExecutable; args = @((Join-Path $PSScriptRoot 'codex-runner.mjs'), '--codex', $codexPath); cwd = $appRoot }
    pollIntervalMs = 10000; heartbeatIntervalMs = 30000; requestTimeoutMs = 15000; runnerTimeoutMs = 240000
}
$configPath = Join-Path $root 'config.json'
$config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding UTF8
# Current-user DPAPI: the saved ciphertext cannot be used by another Windows user.
$secureToken = ConvertTo-SecureString -String $pairing.hostToken -AsPlainText -Force
$secureToken | ConvertFrom-SecureString | Set-Content -LiteralPath (Join-Path $root 'credential.dpapi') -Encoding ASCII
@{ appRoot = $appRoot; nodeExecutable = $nodeExecutable; hostId = $pairing.hostId; providerId = $pairing.providerId; expiresAt = $pairing.expiresAt } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'installation.json') -Encoding UTF8
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'start-windows.ps1') -Destination (Join-Path $root 'Start-NCTracks.ps1') -Force
# Remove only the exact, validated pairing download after confirming DPAPI roundtrip.
$roundTrip = (Get-Content -Raw -LiteralPath (Join-Path $root 'credential.dpapi')).Trim() | ConvertTo-SecureString
if ([Net.NetworkCredential]::new('', $roundTrip).Password -ne $pairing.hostToken) { throw 'Credential protection verification failed; pairing file preserved.' }
Remove-Item -LiteralPath $pairingPath
$pairing = $null; $secureToken.Dispose(); $roundTrip.Dispose()
Write-Output 'Installed the Welliance bridge configuration and protected credential. No portal lookup has run.'
Write-Output "Start script: $(Join-Path $root 'Start-NCTracks.ps1')"
