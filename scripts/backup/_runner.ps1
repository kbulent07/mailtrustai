Start-Transcript -Path "C:\Users\bulent.keklik.IT2\Documents\Codex\projeler\mainpaketler\logs\backup-customer.log" -Append
try {
    & powershell.exe -ExecutionPolicy Bypass -NonInteractive `
        -File "C:\Users\bulent.keklik.IT2\Documents\Codex\projeler\mainpaketler\scripts\backup-windows-customer.ps1" -TargetDir "C:\Users\bulent.keklik.IT2\Documents\Codex\projeler\mainpaketler\backups\auto-weekly"
} finally {
    Stop-Transcript
}
