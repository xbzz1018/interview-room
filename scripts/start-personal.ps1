param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'

$projectDir = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $projectDir 'dist\desktop-interview-room-themes\win-unpacked\TechSpar Personal.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw 'The current personal desktop build is missing: dist\desktop-interview-room-themes\win-unpacked. Run scripts\build-personal.ps1. Older builds are not launched automatically.'
}

# Keep this personal installation separate from the official desktop client.
$personalData = Join-Path $projectDir 'local_tools\personal-data'
if ($CheckOnly) {
    [pscustomobject]@{
        Edition = 'interview-room-three-themes'
        Executable = $executable
        BuiltAt = (Get-Item -LiteralPath $executable).LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
        PersonalData = $personalData
    } | Format-List
    return
}
New-Item -ItemType Directory -Force -Path $personalData | Out-Null
$env:TECHSPAR_DESKTOP_USER_DATA_DIR = $personalData
$env:ALLOW_REGISTRATION = 'false'

# The community build uses the local backend and settings entered in its own UI.
$excludedVariables = @(
    'TECHSPAR_EXTENSIONS', 'TECHSPAR_RENDERER_URL', 'ELECTRON_RUN_AS_NODE',
    'DEFAULT_EMAIL', 'DEFAULT_PASSWORD', 'JWT_SECRET', 'VOICEPRINT_ENCRYPTION_KEY'
)
foreach ($variable in $excludedVariables) {
    # PowerShell 7.6/.NET keeps an empty variable when passed $null here.
    # Electron treats even an empty ELECTRON_RUN_AS_NODE as enabled.
    Remove-Item -LiteralPath ('Env:' + $variable) -ErrorAction SilentlyContinue
}
foreach ($variable in @(Get-ChildItem Env: | Where-Object { $_.Name -like 'PLATFORM_*' -or $_.Name -like 'COPILOT_*' })) {
    Remove-Item -LiteralPath ('Env:' + $variable.Name) -ErrorAction SilentlyContinue
}

# This is the interactive application window the user opens from the launcher.
Write-Host 'Launching Interview Room (three themes):'
Write-Host $executable
Start-Process -FilePath $executable -WorkingDirectory (Split-Path -Parent $executable) -WindowStyle Normal
