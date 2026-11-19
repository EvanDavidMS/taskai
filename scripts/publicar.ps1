# Publica una versión nueva de TaskAI en GitHub (con actualización automática).
#
#   .\scripts\publicar.ps1 -Version 1.3.0 -Notas notas.md
#
# Qué hace:
#   1. Pone la versión en tauri.conf.json, package.json y Cargo.toml.
#   2. Compila el instalador FIRMADO con la llave privada (~\.tauri\taskai.key; nunca se sube a GitHub).
#   3. Crea latest.json: lo que las apps instaladas consultan para saber si hay versión nueva.
#   4. Commit + push, y crea el Release con el instalador y latest.json.
#
# Si pierdes la llave privada, las apps ya instaladas no aceptarán actualizaciones nuevas:
# respáldala (taskai.key) en un lugar seguro.

param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$Notas,   # archivo .md con las notas del Release (en español)
    [switch]$SinPublicar                            # solo compila y genera latest.json, no sube nada
)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$repo = "EvanDavidMS/taskai"

$key = Join-Path $env:USERPROFILE ".tauri\taskai.key"
if (-not (Test-Path $key)) { throw "No encontré la llave de firma en $key" }
if (-not (Test-Path $Notas)) { throw "No encontré el archivo de notas $Notas" }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "La versión debe ser tipo 1.3.0" }

# 1) Versión en los tres archivos
$conf = "src-tauri\tauri.conf.json"
(Get-Content $conf -Raw -Encoding utf8) -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`"" | Set-Content $conf -NoNewline -Encoding utf8
(Get-Content package.json -Raw -Encoding utf8) -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`"" | Set-Content package.json -NoNewline -Encoding utf8
$cargo = "src-tauri\Cargo.toml"
$c = Get-Content $cargo -Raw -Encoding utf8
([regex]'(?m)^version = "[^"]+"').Replace($c, "version = `"$Version`"", 1) | Set-Content $cargo -NoNewline -Encoding utf8
Write-Host "✓ Versión $Version" -ForegroundColor Green

# 2) Compilar firmando
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $key -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
pnpm tauri build
if ($LASTEXITCODE -ne 0) { throw "La compilación falló" }
$exeName = "TaskAI_${Version}_x64-setup.exe"
$exe = "src-tauri\target\release\bundle\nsis\$exeName"
$sig = "$exe.sig"
if (-not (Test-Path $sig)) { throw "No se generó la firma $sig (¿createUpdaterArtifacts?)" }
Write-Host "✓ Instalador firmado: $exe" -ForegroundColor Green

# 3) latest.json
$notesText = (Get-Content $Notas -Raw -Encoding utf8).Trim()
$latest = [ordered]@{
    version   = $Version
    notes     = $notesText
    pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            signature = (Get-Content $sig -Raw).Trim()
            url       = "https://github.com/$repo/releases/download/v$Version/$exeName"
        }
    }
}
$latestPath = "src-tauri\target\release\bundle\latest.json"
$latest | ConvertTo-Json -Depth 5 | Set-Content $latestPath -Encoding utf8
Write-Host "✓ $latestPath" -ForegroundColor Green

if ($SinPublicar) { Write-Host "Listo (sin publicar)."; exit 0 }

# 4) Commit, push y Release
git add -A
git commit -m "Versión $Version" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
gh release create "v$Version" $exe $latestPath --repo $repo --title "TaskAI $Version" --notes-file $Notas --latest
if ($LASTEXITCODE -ne 0) { throw "No se pudo crear el Release" }
Write-Host "✓ Publicado: https://github.com/$repo/releases/tag/v$Version" -ForegroundColor Green
