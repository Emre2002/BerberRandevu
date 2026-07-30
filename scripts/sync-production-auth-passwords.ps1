# Sync production Firebase Auth passwords for superadmin, bedirhan, altinmakas, akkus.
# Run in a normal Windows PowerShell window. Passwords are never echoed.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Set-Location "C:\Projects\BerberRandevu-security"

function Read-SecurePlain([string]$Prompt) {
    $secure = Read-Host -AsSecureString $Prompt
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

function Test-PasswordPolicy([string]$AccountLabel, [string]$Password) {
    if ([string]::IsNullOrWhiteSpace($Password)) {
        throw "$AccountLabel password cannot be empty."
    }
    if ($Password.Length -lt 6) {
        throw "$AccountLabel password must be at least 6 characters."
    }
    if ($Password -ne $Password.Trim()) {
        throw "$AccountLabel password cannot start or end with whitespace."
    }
}

function Read-ConfirmedPassword([string]$AccountLabel) {
    while ($true) {
        $first = Read-SecurePlain "$AccountLabel new password"
        try {
            Test-PasswordPolicy $AccountLabel $first
        } catch {
            Write-Host $_.Exception.Message
            continue
        }
        $confirm = Read-SecurePlain "Confirm $AccountLabel password"
        if ($first -eq $confirm) { return $first }
        Write-Host "Passwords do not match. Try again."
    }
}

function Set-RestrictedFileAcl([string]$Path) {
    try {
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $acl = New-Object System.Security.AccessControl.FileSecurity
        $acl.SetAccessRuleProtection($true, $false)
        $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($identity, "FullControl", "Allow")))
        $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule("SYSTEM", "FullControl", "Allow")))
        Set-Acl -Path $Path -AclObject $acl
    } catch {
        Write-Warning "Could not tighten ACL for $Path."
    }
}

function Resolve-OwnerBusinessId([string]$Username) {
    $payload = @{ username = $Username } | ConvertTo-Json -Compress
    $response = Invoke-RestMethod -Method Post -Uri "https://berberv1.vercel.app/api/resolve-auth-identifier" -ContentType "application/json" -Body $payload
    if (-not $response.authEmail -or -not $response.businessId) {
        throw "Could not resolve businessId for $Username."
    }
    return [string]$response.businessId
}

$superPass = $null
$bedirhanPass = $null
$altinPass = $null
$akkusPass = $null
$syncSummary = @()

try {
    Write-Host "Enter new passwords for four production accounts."
    $superPass = Read-ConfirmedPassword "superadmin"
    $bedirhanPass = Read-ConfirmedPassword "bedirhan"
    $altinPass = Read-ConfirmedPassword "altinmakas"
    $akkusPass = Read-ConfirmedPassword "akkus"

    $payload = @{
        accounts = @(
            @{ username = "superadmin"; password = $superPass; roleHint = "superAdmin" },
            @{ username = "bedirhan"; password = $bedirhanPass; roleHint = "owner" },
            @{ username = "altinmakas"; password = $altinPass; roleHint = "owner" },
            @{ username = "akkus"; password = $akkusPass; roleHint = "owner" }
        )
    } | ConvertTo-Json -Compress

    $syncOutput = $payload | node "scripts/sync-production-auth-passwords.mjs"
    if ($LASTEXITCODE -ne 0) {
        Write-Host $syncOutput
        throw "Firebase Auth password sync failed."
    }

    $parsed = $syncOutput | ConvertFrom-Json
    foreach ($entry in $parsed.results) {
        $syncSummary += [pscustomobject]@{
            username = $entry.username
            ok = [bool]$entry.ok
            updated = [bool]$entry.updated
            errorCode = $entry.errorCode
        }
    }

    if (-not $parsed.ok) {
        $syncSummary | Format-Table -AutoSize
        throw "One or more accounts failed to sync."
    }

    $saFile = ".local-private/superadmin-credentials.txt"
    $csvFile = ".local-private/business-login-credentials.csv"

    if (-not (Test-Path ".local-private")) { New-Item -ItemType Directory -Path ".local-private" | Out-Null }

    $bedirhanBusinessId = Resolve-OwnerBusinessId "bedirhan"
    $altinBusinessId = Resolve-OwnerBusinessId "altinmakas"
    $akkusBusinessId = Resolve-OwnerBusinessId "akkus"

    $superContent = @("Username=superadmin", "Password=$superPass") -join [Environment]::NewLine
    [System.IO.File]::WriteAllText((Resolve-Path .).Path + "\$saFile", $superContent, [System.Text.UTF8Encoding]::new($false))

    $csvLines = @(
        "businessName,username,temporaryPassword,businessId,accountStatus",
        "X-Men,bedirhan,$bedirhanPass,$bedirhanBusinessId,active",
        "Altın Makas,altinmakas,$altinPass,$altinBusinessId,active",
        "Akkus,akkus,$akkusPass,$akkusBusinessId,active"
    )
    [System.IO.File]::WriteAllText((Resolve-Path .).Path + "\$csvFile", ($csvLines -join [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))

    Set-RestrictedFileAcl (Resolve-Path $saFile).Path
    Set-RestrictedFileAcl (Resolve-Path $csvFile).Path

    Write-Host "Password sync summary:"
    $syncSummary | Format-Table -AutoSize
    Write-Host "Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-production-final-validation.ps1"
} finally {
    $superPass = $null
    $bedirhanPass = $null
    $altinPass = $null
    $akkusPass = $null
    Remove-Item Env:SMOKE_SA_PASS -ErrorAction SilentlyContinue
    Remove-Item Env:SMOKE_PASS_BEDIRHAN -ErrorAction SilentlyContinue
    Remove-Item Env:SMOKE_PASS_ALTINMAKAS -ErrorAction SilentlyContinue
    Remove-Item Env:SMOKE_PASS_AKKUS -ErrorAction SilentlyContinue
}
