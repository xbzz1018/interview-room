param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
# Keep the compiler in an ASCII-only path for Bun's Windows executable build.
$buildToolsDir = Join-Path ([IO.Path]::GetTempPath()) 'techspar-personal-build-tools'
$buildBun = Join-Path $buildToolsDir 'bun.exe'
$portableBun = Join-Path (Split-Path -Parent $projectDir) 'tools\bun-1.3.14\bun-windows-x64\bun.exe'
if (-not (Test-Path -LiteralPath $portableBun -PathType Leaf)) {
    $installedBun = Get-Command bun -CommandType Application -ErrorAction SilentlyContinue
    if ($installedBun) {
        $portableBun = $installedBun.Source
    } elseif (Test-Path -LiteralPath $buildBun -PathType Leaf) {
        $portableBun = $buildBun
    } else {
        throw 'Bun is missing. Install Bun 1.3.14 and add it to PATH, then rerun scripts\build-personal.ps1.'
    }
}

if ($CheckOnly) {
    [pscustomobject]@{
        Project = $projectDir
        Bun = $portableBun
        Output = Join-Path $projectDir 'dist\desktop-interview-room-themes\win-unpacked'
    } | Format-List
    return
}

New-Item -ItemType Directory -Force -Path $buildToolsDir | Out-Null
if ([IO.Path]::GetFullPath($portableBun) -ne [IO.Path]::GetFullPath($buildBun)) {
    Copy-Item -LiteralPath $portableBun -Destination $buildBun -Force
}
$env:PATH = $buildToolsDir + [IO.Path]::PathSeparator + $env:PATH

Push-Location -LiteralPath $projectDir
try {
    & $buildBun install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    & $buildBun run pack:desktop:personal
    if ($LASTEXITCODE -ne 0) { throw 'Personal desktop build failed.' }
} finally {
    Pop-Location
}
