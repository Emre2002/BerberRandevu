# Sync production Firebase Auth passwords for superadmin, altinmakas, akkus.
# Run in a normal Windows PowerShell window. Passwords are never echoed.
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

function Read-ConfirmedPassword([string]$AccountLabel) {
    while ($true) {
        $first = Read-SecurePlain "$AccountLabel new password"
        if ([string]::IsNullOrWhiteSpace($first)) {
            Write-Host "$AccountLabel password cannot be empty."
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

$superPass = $null
$altinPass = $null
$akkusPass = $null
$bedirhanPass = $null

try {
    $superPass = Read-ConfirmedPassword "superadmin"
    $altinPass = Read-ConfirmedPassword "altinmakas"
    $akkusPass = Read-ConfirmedPassword "akkus"

    $payload = @{
        accounts = @(
            @{ username = "superadmin"; password = $superPass; roleHint = "superAdmin" },
            @{ username = "altinmakas"; password = $altinPass; roleHint = "owner" },
            @{ username = "akkus"; password = $akkusPass; roleHint = "owner" }
        )
    } | ConvertTo-Json -Compress

    $payload | node "scripts/sync-production-auth-passwords.mjs"
    if ($LASTEXITCODE -ne 0) { throw "Firebase Auth password sync failed." }

    $saFile = ".local-private/superadmin-credentials.txt"
    $csvFile = ".local-private/business-login-credentials.csv"

    if (-not (Test-Path ".local-private")) { New-Item -ItemType Directory -Path ".local-private" | Out-Null }

    if (Test-Path $csvFile) {
        $bedirhanLine = Get-Content $csvFile | Where-Object { $_ -match ",bedirhan," } | Select-Object -First 1
        if ($bedirhanLine) {
            $bedirhanPass = ($bedirhanLine.Split(",")[2]).Trim()
        }
    }

    $superContent = @("Username=superadmin", "Password=$superPass") -join [Environment]::NewLine
    [System.IO.File]::WriteAllText((Resolve-Path .).Path + "\$saFile", $superContent, [System.Text.UTF8Encoding]::new($false))

    $csvLines = @("businessName,username,temporaryPassword,businessId,accountStatus")
    if ($bedirhanPass) {
        $csvLines += "X-Men,bedirhan,$bedirhanPass,x-men,active"
    } else {
        $existing = Get-Content $csvFile -ErrorAction SilentlyContinue | Where-Object { $_ -match ",bedirhan," } | Select-Object -First 1
        if ($existing) { $csvLines += $existing }
    }
    $csvLines += "Altın Makas,altinmakas,$altinPass,altinmakas,active"
    $csvLines += "Akkus,akkus,$akkusPass,akkus,active"
    [System.IO.File]::WriteAllText((Resolve-Path .).Path + "\$csvFile", ($csvLines -join [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))

    Set-RestrictedFileAcl (Resolve-Path $saFile).Path
    Set-RestrictedFileAcl (Resolve-Path $csvFile).Path

    Write-Host "Password sync completed for superadmin, altinmakas, akkus."
    Write-Host "Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-production-final-validation.ps1"
} finally {
    $superPass = $null
    $altinPass = $null
    $akkusPass = $null
    $bedirhanPass = $null
    Remove-Item Env:SMOKE_SA_PASS -ErrorAction SilentlyContinue
    Remove-Item Env:SMOKE_PASS_ALTINMAKAS -ErrorAction SilentlyContinue
    Remove-Item Env:SMOKE_PASS_AKKUS -ErrorAction SilentlyContinue
}
