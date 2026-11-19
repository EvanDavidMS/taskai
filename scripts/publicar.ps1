# Publica una versión nueva de TaskAI en GitHub (con actualización automática).
#
#   .\scripts\publicar.ps1 -Version 1.4.3 -Notas scripts\notas-1.4.3.md
#
# Qué hace:
#   1. Pone la versión en tauri.conf.json, package.json y Cargo.toml, hace commit y push.
#   2. Lanza el workflow "Compilar y firmar" (.github/workflows/compilar.yml) en GitHub Actions y
#      espera a que termine. Ahí se compila desde el código del repo:
#        - Windows: instalador NSIS (y, si SignPath está configurado, taskai.exe e instalador firmados;
#          cada firma la apruebas tú en signpath.io).
#        - Linux: .deb, .rpm y AppImage.
#   3. Descarga todo y, AQUÍ en tu compu, crea las firmas de actualizaciones (.sig) con la llave
#      privada (~\.tauri\taskai.key; nunca se sube a GitHub) y el latest.json.
#   4. Crea el Release con los instaladores y latest.json.
#
#   -Local        → compila solo Windows en esta compu en vez de Actions (sin SignPath ni Linux).
#   -SinPublicar  → como -Local, pero solo genera latest.json, sin subir nada.
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
$workflow = "compilar.yml"

$key = Join-Path $env:USERPROFILE ".tauri\taskai.key"
if (-not (Test-Path $key)) { throw "No encontré la llave de firma en $key" }
if (-not (Test-Path $Notas)) { throw "No encontré el archivo de notas $Notas" }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "La versión debe ser tipo 1.3.0" }
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $key -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
$setupName = "TaskAI_${Version}_x64-setup.exe"

# 1) Versión en los tres archivos
$conf = "src-tauri\tauri.conf.json"
(Get-Content $conf -Raw -Encoding utf8) -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`"" | Set-Content $conf -NoNewline -Encoding utf8
(Get-Content package.json -Raw -Encoding utf8) -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`"" | Set-Content package.json -NoNewline -Encoding utf8
$cargo = "src-tauri\Cargo.toml"
$c = Get-Content $cargo -Raw -Encoding utf8
([regex]'(?m)^version = "[^"]+"').Replace($c, "version = `"$Version`"", 1) | Set-Content $cargo -NoNewline -Encoding utf8
Write-Host "✓ Versión $Version" -ForegroundColor Green

# Firma de actualizaciones (.sig) de un instalador, con la llave local
function New-UpdaterSig([string]$file) {
    pnpm tauri signer sign $file | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path "$file.sig")) { throw "No se pudo firmar $file para las actualizaciones" }
    (Get-Content "$file.sig" -Raw).Trim()
}
$base = "https://github.com/$repo/releases/download/v$Version"
$platforms = [ordered]@{}
$assets = @()

if ($Local -or $SinPublicar) {
    # 2) Compilar aquí (solo Windows), firmando las actualizaciones
    pnpm tauri build
    if ($LASTEXITCODE -ne 0) { throw "La compilación falló" }
    $setup = "src-tauri\target\release\bundle\nsis\$setupName"
    $sigText = (Get-Content "$setup.sig" -Raw).Trim()
    $platforms["windows-x86_64"] = [ordered]@{ signature = $sigText; url = "$base/$setupName" }
    $assets += $setup
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
    Write-Host "… Compilando Windows y Linux en GitHub (unos 15 min). Si SignPath está activo, aprueba las 2 firmas en signpath.io" -ForegroundColor Cyan
    gh run watch $run.databaseId --repo $repo --exit-status
    if ($LASTEXITCODE -ne 0) { throw "La compilación en GitHub falló: gh run view $($run.databaseId) --repo $repo --log-failed" }

    $dir = "src-tauri\target\release\bundle\actions"
    if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
    gh run download $run.databaseId --repo $repo --name TaskAI-windows --dir "$dir\windows"
    if ($LASTEXITCODE -ne 0) { throw "No pude descargar lo de Windows" }
    gh run download $run.databaseId --repo $repo --name TaskAI-linux --dir "$dir\linux"
    if ($LASTEXITCODE -ne 0) { throw "No pude descargar lo de Linux" }

    # 3) Windows
    $setup = Join-Path "$dir\windows" $setupName
    if ((Get-Item $setup).VersionInfo.ProductVersion -ne $Version) { throw "El instalador descargado no es la versión $Version" }
    Write-Host ("✓ Windows: firma de código = {0}" -f (Get-AuthenticodeSignature $setup).Status) -ForegroundColor Green
    $sig = New-UpdaterSig $setup
    $win = [ordered]@{ signature = $sig; url = "$base/$setupName" }
    $platforms["windows-x86_64"] = $win
    $platforms["windows-x86_64-nsis"] = $win
    $assets += $setup

    # 3) Linux: el actualizador busca "linux-x86_64-<appimage|deb|rpm>" según cómo se instaló,
    #    y si no, "linux-x86_64" (ahí va el AppImage, que sirve en cualquier distro)
    $linux = @{
        appimage = Get-ChildItem "$dir\linux" -Filter "*.AppImage" | Select-Object -First 1
        deb      = Get-ChildItem "$dir\linux" -Filter "*.deb" | Select-Object -First 1
        rpm      = Get-ChildItem "$dir\linux" -Filter "*.rpm" | Select-Object -First 1
    }
    foreach ($k in "appimage", "deb", "rpm") {
        $f = $linux[$k]
        if (-not $f) { throw "Falta el .$k de Linux" }
        if ($f.Name -notmatch [regex]::Escape($Version)) { throw "$($f.Name) no es la versión $Version" }
        $entry = [ordered]@{ signature = (New-UpdaterSig $f.FullName); url = "$base/$($f.Name)" }
        $platforms["linux-x86_64-$k"] = $entry
        if ($k -eq "appimage") { $platforms["linux-x86_64"] = $entry }
        $assets += $f.FullName
    }
    Write-Host "✓ Linux: $($linux.appimage.Name), $($linux.deb.Name), $($linux.rpm.Name)" -ForegroundColor Green
}

# 3) latest.json
$latest = [ordered]@{
    version   = $Version
    notes     = (Get-Content $Notas -Raw -Encoding utf8).Trim()
    pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = $platforms
}
$latestPath = "src-tauri\target\release\bundle\latest.json"
$latest | ConvertTo-Json -Depth 5 | Set-Content $latestPath -Encoding utf8
Write-Host "✓ $latestPath ($($platforms.Keys -join ', '))" -ForegroundColor Green

if ($SinPublicar) { Write-Host "Listo (sin publicar)."; exit 0 }

# 4) (Modo -Local: commit y push aquí) y Release
if ($Local) {
    git add -A
    git commit -m "Versión $Version" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
    git push
}
gh release create "v$Version" @assets $latestPath --repo $repo --title "TaskAI $Version" --notes-file $Notas --latest
if ($LASTEXITCODE -ne 0) { throw "No se pudo crear el Release" }
Write-Host "✓ Publicado: https://github.com/$repo/releases/tag/v$Version" -ForegroundColor Green
