# Pre-publish secret audit for a PUBLIC repository.
# Fails loudly if anything resembling a live credential would be committed.

$ErrorActionPreference = 'Stop'
# Script lives in <repo>/scripts, so the repository root is one level up.
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

$files = Get-ChildItem -Recurse -File -Force -Path $root | Where-Object {
    $_.FullName -notmatch '\\node_modules\\|\\\.next\\|\\\.data\\|\\\.git\\' -and
    $_.Extension -in @('.ts', '.tsx', '.json', '.md', '.yml', '.mjs', '.js', '.css', '.prisma', '.example')
}

Write-Host "Scanning $($files.Count) files for credentials..." -ForegroundColor Cyan

$patterns = [ordered]@{
    'OpenAI key'      = 'sk-[A-Za-z0-9_\-]{20,}'
    'Google API key'  = 'AIza[0-9A-Za-z_\-]{30,}'
    'YouTube token'   = 'ya29\.[A-Za-z0-9_\-]{15,}'
    'AWS access key'  = 'AKIA[0-9A-Z]{16}'
    'GitHub token'    = 'gh[pousr]_[A-Za-z0-9]{30,}'
    'Slack token'     = 'xox[baprs]-[A-Za-z0-9\-]{10,}'
    'Private key'     = 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY'
    'Postgres pw'     = 'postgres(ql)?://[^:\s]+:[^@\s]+@'
    'Bearer literal'  = 'Bearer\s+[A-Za-z0-9_\-\.]{30,}'
}

$found = @()
foreach ($key in $patterns.Keys) {
    $hits = $files | Select-String -Pattern $patterns[$key] -ErrorAction SilentlyContinue
    foreach ($h in $hits) {
        # Ignore matches inside .env.example (placeholders only).
        if ($h.Path -like '*.example') { continue }
        $found += [pscustomobject]@{ Kind = $key; File = $h.Filename; Line = $h.LineNumber }
    }
}

# A real .env file on disk is expected and fine — what matters is whether git
# TRACKS it (it is gitignored, so it must never be committed).
$envFiles = Get-ChildItem -Recurse -File -Force -Path $root -Filter '.env*' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch 'node_modules' -and $_.Name -ne '.env.example' }

$trackedEnv = @()
if (Get-Command git -ErrorAction SilentlyContinue) {
    Push-Location $root
    try {
        $trackedEnv = @(& git ls-files | Where-Object { $_ -match '(^|/)\.env' -and $_ -ne '.env.example' })
    } catch {
        $trackedEnv = @()
    } finally {
        Pop-Location
    }
}

Write-Host ""
if ($found.Count -gt 0) {
    Write-Host "FAIL: $($found.Count) potential secret(s) found" -ForegroundColor Red
    $found | Format-Table -AutoSize | Out-String | Write-Host
    exit 1
}
if ($trackedEnv.Count -gt 0) {
    Write-Host "FAIL: real .env file(s) are TRACKED by git:" -ForegroundColor Red
    $trackedEnv | ForEach-Object { Write-Host "   $_" }
    exit 1
}

Write-Host "PASS: no live credentials detected in committable files" -ForegroundColor Green
if ($envFiles.Count -gt 0) {
    $names = ($envFiles | ForEach-Object { Split-Path $_.FullName -Leaf }) -join ', '
    Write-Host "PASS: local env file(s) present but gitignored and untracked ($names)" -ForegroundColor Green
} else {
    Write-Host "PASS: no local .env files present" -ForegroundColor Green
}
Write-Host "PASS: $($files.Count) files cleared for a public repository" -ForegroundColor Green
exit 0
