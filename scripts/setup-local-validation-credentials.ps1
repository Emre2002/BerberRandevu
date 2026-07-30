# One-time local credential setup for production validation smoke tests.
# Run directly in a normal Windows PowerShell window (not via Cloud Agent).
$ErrorActionPreference = "Stop"
Set-Location "C:\Projects\BerberRandevu-security"

$PrivateDir = ".local-private"
$SuperAdminFile = Join-Path $PrivateDir "superadmin-credentials.txt"
$OwnerCsvFile = Join-Path $PrivateDir "business-login-credentials.csv"

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
        $first = Read-SecurePlain "$AccountLabel password"
        if ([string]::IsNullOrWhiteSpace($first)) {
            Write-Host "$AccountLabel password cannot be empty."
            continue
        }
        $confirm = Read-SecurePlain "Confirm $AccountLabel password"
        if ($first -eq $confirm) {
            return $first
        }
        Write-Host "Passwords do not match. Try again."
    }
}

function Confirm-Overwrite([string]$Path) {
    if (-not (Test-Path $Path)) { return $true }
    $answer = Read-Host "File already exists: $Path. Overwrite? (y/N)"
    return ($answer -eq "y" -or $answer -eq "Y")
}

function Set-RestrictedFileAcl([string]$Path) {
    try {
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $acl = New-Object System.Security.AccessControl.FileSecurity
        $acl.SetAccessRuleProtection($true, $false)
        $userRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $identity, "FullControl", "Allow"
        )
        $systemRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            "SYSTEM", "FullControl", "Allow"
        )
        $acl.AddAccessRule($userRule)
        $acl.AddAccessRule($systemRule)
        Set-Acl -Path $Path -AclObject $acl
    } catch {
        Write-Warning "Could not tighten ACL for $Path. File was still written."
    }
}

if (-not (Test-Path $PrivateDir)) {
    New-Item -ItemType Directory -Path $PrivateDir | Out-Null
}

if (-not (Confirm-Overwrite $SuperAdminFile)) {
    Write-Host "Aborted. Existing super-admin credentials kept."
    exit 1
}
if (-not (Confirm-Overwrite $OwnerCsvFile)) {
    Write-Host "Aborted. Existing owner credentials kept."
    exit 1
}

$superAdminPassword = Read-ConfirmedPassword "superadmin"
$bedirhanPassword = Read-ConfirmedPassword "bedirhan"
$altinmakasPassword = Read-ConfirmedPassword "altinmakas"
$akkusPassword = Read-ConfirmedPassword "akkus"

# businessId values verified against production owner redirect slugs / auth resolver tenant ids.
$superAdminContent = @(
    "Username=superadmin"
    "Password=$superAdminPassword"
) -join [Environment]::NewLine

$ownerCsvContent = @(
    "businessName,username,temporaryPassword,businessId,accountStatus"
    "X-Men,bedirhan,$bedirhanPassword,x-men,active"
    "Altın Makas,altinmakas,$altinmakasPassword,altinmakas,active"
    "Akkus,akkus,$akkusPassword,akkus,active"
) -join [Environment]::NewLine

[System.IO.File]::WriteAllText((Resolve-Path .).Path + "\$SuperAdminFile", $superAdminContent, [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText((Resolve-Path .).Path + "\$OwnerCsvFile", $ownerCsvContent, [System.Text.UTF8Encoding]::new($false))

Set-RestrictedFileAcl (Resolve-Path $SuperAdminFile).Path
Set-RestrictedFileAcl (Resolve-Path $OwnerCsvFile).Path

Write-Host "Credential files created."
Write-Host (Resolve-Path $SuperAdminFile).Path
Write-Host (Resolve-Path $OwnerCsvFile).Path
Write-Host 'Run validation with:'
Write-Host 'powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Projects\BerberRandevu-security\scripts\run-production-final-validation.ps1"'
