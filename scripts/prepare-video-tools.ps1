param([switch]$Force)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Get-Sha256([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-', '') }
    finally { $stream.Dispose(); $hash.Dispose() }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repoRoot = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $repoRoot 'src-tauri/resources/download-tools'
$manifestPath = Join-Path $PSScriptRoot 'video-tools.json'
$manifestHash = Get-Sha256 $manifestPath
$receipt = Join-Path $destination 'installed.json'
if (!$Force -and (Test-Path -LiteralPath $receipt)) {
    $installed = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
    $valid = $installed.manifest -eq $manifestHash
    foreach ($file in $installed.files) {
        $path = Join-Path $destination $file.name
        if (!(Test-Path -LiteralPath $path) -or (Get-Sha256 $path) -ne $file.sha256) { $valid = $false; break }
    }
    if ($valid -and $installed.files.Count -ge 4) { Write-Output 'Video download tools are ready.'; exit 0 }
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$staging = Join-Path ([System.IO.Path]::GetTempPath()) ('auraview-tools-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null
try {
    foreach ($entry in $manifest.PSObject.Properties) {
        $tool = $entry.Value
        $archive = Join-Path $staging ([System.IO.Path]::GetFileName(([uri]$tool.url).AbsolutePath))
        Write-Output "Fetching $($entry.Name) $($tool.version)..."
        Invoke-WebRequest -Uri $tool.url -OutFile $archive -UseBasicParsing
        if ((Get-Sha256 $archive).ToLowerInvariant() -ne $tool.sha256) {
            throw "Checksum mismatch for $($entry.Name). No unverified executable will be installed."
        }
        if ($archive.EndsWith('.zip')) {
            [System.IO.Compression.ZipFile]::ExtractToDirectory($archive, (Join-Path $staging $entry.Name))
        }
    }
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $staging 'yt-dlp.exe') -Destination $destination
    Copy-Item -LiteralPath (Join-Path $staging 'deno/deno.exe') -Destination $destination
    $ffmpeg = Get-ChildItem -LiteralPath (Join-Path $staging 'ffmpeg') -Filter 'ffmpeg.exe' -Recurse | Select-Object -First 1
    if (!$ffmpeg) { throw 'FFmpeg archive has no executable' }
    Get-ChildItem -LiteralPath $ffmpeg.DirectoryName -File | Where-Object { $_.Extension -in @('.exe', '.dll') -and $_.Name -ne 'ffplay.exe' } | Copy-Item -Destination $destination
    $license = Get-ChildItem -LiteralPath (Join-Path $staging 'ffmpeg') -Filter 'LICENSE*' -Recurse | Select-Object -First 1
    if ($license) { Copy-Item -LiteralPath $license.FullName -Destination (Join-Path $destination 'FFmpeg-LICENSE.txt') }
    $files = @(Get-ChildItem -LiteralPath $destination -File | Where-Object { $_.Extension -in @('.exe', '.dll') } | ForEach-Object {
        @{ name = $_.Name; sha256 = (Get-Sha256 $_.FullName) }
    })
    @{ manifest = $manifestHash; files = $files } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $receipt -Encoding UTF8
    Write-Output 'Video download tools are ready.'
} finally {
    $resolvedStaging = [System.IO.Path]::GetFullPath($staging)
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolvedStaging.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedStaging).StartsWith('auraview-tools-')) {
        Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
    }
}
