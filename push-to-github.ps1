# Push this repo to GitHub. Run in PowerShell from project root.
$git = "C:\Program Files\Git\bin\git.exe"
if (-not (Test-Path $git)) { $git = "git" }

$repoUrl = "https://github.com/Don704/marketflow.git"

Set-Location $PSScriptRoot

# Ensure origin points to their repo
$current = & $git remote get-url origin 2>$null
if ($LASTEXITCODE -ne 0 -or -not $current) {
    & $git remote add origin $repoUrl
    Write-Host "Added remote origin: $repoUrl"
} else {
    & $git remote set-url origin $repoUrl
    Write-Host "Set remote origin to: $repoUrl"
}

& $git add .
& $git status
$msg = & $git status -s
if (-not $msg) {
    Write-Host "Nothing to commit. Pushing existing commits..."
} else {
    & $git commit -m "Add Render deploy config, .env.example, and server listen fix for production"
}
$branch = & $git rev-parse --abbrev-ref HEAD
& $git push -u origin $branch
Write-Host "Done. Open your repo on GitHub to confirm, then connect it in Render (New + > Blueprint)." -ForegroundColor Green
