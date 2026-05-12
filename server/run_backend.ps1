param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"

$ServerDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $ServerDir ".venv\Scripts\python.exe"

if (-not (Test-Path $Python)) {
    Write-Host "Creating Python virtual environment..."
    python -m venv (Join-Path $ServerDir ".venv")

    Write-Host "Installing backend requirements..."
    & $Python -m pip install -r (Join-Path $ServerDir "requirements.txt")
}

Write-Host "Starting GridLens backend on http://localhost:$Port"
& $Python -m uvicorn main:app --reload --host 0.0.0.0 --port $Port
