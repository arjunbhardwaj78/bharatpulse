# Usage:  .\apply.ps1 "$HOME\Downloads\bharatpulse-dropA.zip" "drop A"
# Unpacks a stage zip over this repo, installs, tests, and only pushes if the tests pass.
param([Parameter(Mandatory)][string]$Zip, [string]$Msg = "update")
$tmp = Join-Path $env:TEMP "bp-apply"
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive $Zip $tmp
Copy-Item "$tmp\bharatpulse\*" . -Recurse -Force
npm install
npm test
if ($LASTEXITCODE -eq 0) { git add -A; git commit -m $Msg; git push } else { Write-Host "Tests failed: nothing was committed or pushed." }
