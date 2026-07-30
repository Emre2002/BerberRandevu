# Production final validation runner — reads ignored local credential files only.
$ErrorActionPreference = "Stop"
Set-Location "C:\Projects\BerberRandevu-security"

$SuperAdminFile = ".local-private\superadmin-credentials.txt"
$OwnerCsvFile = ".local-private\business-login-credentials.csv"
$ValidationScript = "scripts\production-final-validation.mjs"

function Import-CredentialEnvironment {
    if (-not (Test-Path $SuperAdminFile)) {
        throw "Missing credential file: $SuperAdminFile. Run scripts/setup-local-validation-credentials.ps1 first."
    }
    if (-not (Test-Path $OwnerCsvFile)) {
        throw "Missing credential file: $OwnerCsvFile. Run scripts/setup-local-validation-credentials.ps1 first."
    }

    $superContent = Get-Content $SuperAdminFile -Raw
    if ($superContent -match '(?m)^Username=(.+)$') {
        $env:SMOKE_SA_USER = $Matches[1].Trim()
    }
    if ($superContent -match '(?m)^Password=(.+)$') {
        $env:SMOKE_SA_PASS = $Matches[1].Trim()
    }
    if (-not $env:SMOKE_SA_USER -or -not $env:SMOKE_SA_PASS) {
        throw "Invalid super-admin credential file format."
    }

    $ownerLines = Get-Content $OwnerCsvFile | Where-Object { $_.Trim() -and $_ -notmatch '^businessName' }
    foreach ($line in $ownerLines) {
        $cols = $line.Split(",") | ForEach-Object { $_.Trim() }
        if ($cols.Count -lt 3) { continue }
        switch ($cols[1]) {
            "bedirhan" { $env:SMOKE_PASS_BEDIRHAN = $cols[2] }
            "altinmakas" { $env:SMOKE_PASS_ALTINMAKAS = $cols[2] }
            "akkus" { $env:SMOKE_PASS_AKKUS = $cols[2] }
        }
    }

    if (-not $env:SMOKE_PASS_BEDIRHAN -or -not $env:SMOKE_PASS_ALTINMAKAS -or -not $env:SMOKE_PASS_AKKUS) {
        throw "Owner credential CSV is missing one or more required accounts."
    }
}

$env:SMOKE_BASE_URL = "https://berberv1.vercel.app"

try {
    Import-CredentialEnvironment
    node $ValidationScript
    $exitCode = $LASTEXITCODE
} catch {
    Write-Error $_.Exception.Message
    $exitCode = 1
} finally {
    Remove-Item Env:SMOKE_SA_USER -ErrorAction SilentlyContinue
    Remove-Item Env:SMOKE_SA_PASS -ErrorAction SilentlyContinue
    Remove-Item Env:SMOKE_PASS_BEDIRHAN -ErrorAction SilentlyContinue
    Remove-Item Env:SMOKE_PASS_ALTINMAKAS -ErrorAction SilentlyContinue
    Remove-Item Env:SMOKE_PASS_AKKUS -ErrorAction SilentlyContinue
    Remove-Item Env:SMOKE_PASS -ErrorAction SilentlyContinue
}

exit $exitCode
