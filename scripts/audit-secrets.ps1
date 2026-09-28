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

# Also flag any non-example .env file.
$envFiles = Get-ChildItem -Recurse -File -Force -Path $root -Filter '.env*' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch 'node_modules' -and $_.Name -ne '.env.example' }

Write-Host ""
if ($found.Count -gt 0) {
    Write-Host "FAIL: $($found.Count) potential secret(s) found" -ForegroundColor Red
    $found | Format-Table -AutoSize | Out-String | Write-Host
    exit 1
}
if ($envFiles.Count -gt 0) {
    Write-Host "FAIL: real .env file(s) present:" -ForegroundColor Red
    $envFiles | ForEach-Object { Write-Host "   $($_.FullName)" }
    exit 1
}

Write-Host "PASS: no live credentials detected" -ForegroundColor Green
Write-Host "PASS: no real .env files present (only .env.example with placeholders)" -ForegroundColor Green
Write-Host "PASS: $($files.Count) files cleared for a public repository" -ForegroundColor Green
exit 0
