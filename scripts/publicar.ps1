# Publica una versión nueva de TaskAI en GitHub (con actualización automática).
#
#   .\scripts\publicar.ps1 -Version 1.4.1 -Notas scripts\notas-1.4.1.md
#
# Qué hace:
#   1. Pone la versión en tauri.conf.json, package.json y Cargo.toml, hace commit y push.
#   2. Lanza el workflow "Compilar y firmar (Windows)" en GitHub Actions y espera a que termine.
#      Ahí se compila desde el código del repo y, si SignPath está configurado, se firman
#      taskai.exe y el instalador (cada firma la apruebas tú en signpath.io).
#   3. Descarga el instalador y, AQUÍ en tu compu, crea su firma de actualizaciones (.sig) con la
#      llave privada (~\.tauri\taskai.key; nunca se sube a GitHub) y el latest.json.
#   4. Crea el Release con el instalador y latest.json.
#
#   -Local        → compila en esta compu en vez de Actions (sin la firma de SignPath).
#   -SinPublicar  → compila en esta compu y genera latest.json, sin subir nada.
#
# Si pierdes la llave privada, las apps ya instaladas no aceptarán actualizaciones nuevas:
# respáldala (taskai.key) en un lugar seguro.

param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$Notas,   # archivo .md con las notas del Release (en español)
    [switch]$Local,
    [switch]$SinPublicar
)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$repo = "EvanDavidMS/taskai"
$workflow = "compilar-windows.yml"

$key = Join-Path $env:USERPROFILE ".tauri\taskai.key"
if (-not (Test-Path $key)) { throw "No encontré la llave de firma en $key" }
if (-not (Test-Path $Notas)) { throw "No encontré el archivo de notas $Notas" }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "La versión debe ser tipo 1.3.0" }
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $key -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
$exeName = "TaskAI_${Version}_x64-setup.exe"

# 1) Versión en los tres archivos
$conf = "src-tauri\tauri.conf.json"
(Get-Content $conf -Raw -Encoding utf8) -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`"" | Set-Content $conf -NoNewline -Encoding utf8
(Get-Content package.json -Raw -Encoding utf8) -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`"" | Set-Content package.json -NoNewline -Encoding utf8
$cargo = "src-tauri\Cargo.toml"
$c = Get-Content $cargo -Raw -Encoding utf8
([regex]'(?m)^version = "[^"]+"').Replace($c, "version = `"$Version`"", 1) | Set-Content $cargo -NoNewline -Encoding utf8
Write-Host "✓ Versión $Version" -ForegroundColor Green

if ($Local -or $SinPublicar) {
    # 2) Compilar aquí, firmando las actualizaciones
    pnpm tauri build
    if ($LASTEXITCODE -ne 0) { throw "La compilación falló" }
    $exe = "src-tauri\target\release\bundle\nsis\$exeName"
} else {
    # 2) Commit + push y compilar en GitHub Actions
    cargo update --workspace --manifest-path src-tauri\Cargo.toml --offline 2>$null  # Cargo.lock con la versión nueva
    git add -A
    git commit -m "Versión $Version" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
    git push
    if ($LASTEXITCODE -ne 0) { throw "No se pudo hacer push" }
    $sha = (git rev-parse HEAD).Trim()
    gh workflow run $workflow --repo $repo --ref main
    if ($LASTEXITCODE -ne 0) { throw "No se pudo lanzar el workflow" }
    Write-Host "… Esperando a que GitHub empiece a compilar" -ForegroundColor Cyan
    $run = $null
    for ($i = 0; $i -lt 30 -and -not $run; $i++) {
        Start-Sleep -Seconds 4
        $run = gh run list --repo $repo --workflow $workflow --limit 5 --json databaseId,headSha |
            ConvertFrom-Json | Where-Object { $_.headSha -eq $sha } | Select-Object -First 1
    }
    if (-not $run) { throw "No encontré la compilación en GitHub Actions" }
    Write-Host "… Compilando en GitHub (unos 10-15 min). Si SignPath está activo, aprueba las 2 firmas en signpath.io" -ForegroundColor Cyan
    gh run watch $run.databaseId --repo $repo --exit-status
    if ($LASTEXITCODE -ne 0) { throw "La compilación en GitHub falló: gh run view $($run.databaseId) --repo $repo --log-failed" }

    $dir = "src-tauri\target\release\bundle\actions"
    if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
    gh run download $run.databaseId --repo $repo --name TaskAI-windows --dir $dir
    if ($LASTEXITCODE -ne 0) { throw "No pude descargar el instalador de GitHub" }
    $exe = Join-Path $dir $exeName
    if ((Get-Item $exe).VersionInfo.ProductVersion -ne $Version) { throw "El instalador descargado no es la versión $Version" }
    $firma = Get-AuthenticodeSignature $exe
    Write-Host ("✓ Instalador de GitHub: firma de Windows = {0}" -f $firma.Status) -ForegroundColor Green

    # 3) Firma de actualizaciones (.sig), aquí, sobre el instalador ya firmado
    pnpm tauri signer sign $exe
    if ($LASTEXITCODE -ne 0) { throw "No se pudo firmar para las actualizaciones" }
}
$sig = "$exe.sig"
if (-not (Test-Path $sig)) { throw "No se generó la firma $sig" }
Write-Host "✓ Instalador listo: $exe" -ForegroundColor Green

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

# 4) (Modo -Local: commit y push aquí) y Release
if ($Local) {
    git add -A
    git commit -m "Versión $Version" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
    git push
}
gh release create "v$Version" $exe $latestPath --repo $repo --title "TaskAI $Version" --notes-file $Notas --latest
if ($LASTEXITCODE -ne 0) { throw "No se pudo crear el Release" }
Write-Host "✓ Publicado: https://github.com/$repo/releases/tag/v$Version" -ForegroundColor Green
