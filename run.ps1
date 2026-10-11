$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$BundledPython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

Set-Location $Root

if (Test-Path $BundledPython) {
  & $BundledPython "backend\app.py"
  exit $LASTEXITCODE
}

$Python = Get-Command python -ErrorAction SilentlyContinue
if ($Python) {
  & $Python.Source "backend\app.py"
  exit $LASTEXITCODE
}

$PyLauncher = Get-Command py -ErrorAction SilentlyContinue
if ($PyLauncher) {
  & $PyLauncher.Source -3 "backend\app.py"
  exit $LASTEXITCODE
}

throw "Python was not found. Install Python 3.10+ or run this project from Codex with the bundled runtime."
