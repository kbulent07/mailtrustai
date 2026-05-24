# Bu dosya schedule-taskscheduler.ps1 tarafindan otomatik olusturulur.
# Manuel duzenleme yapmayin — schedule-taskscheduler.ps1 -Remove + yeniden kur.
Start-Transcript -Path "C:\MailTrustAI\backups\backup-customer.log" -Append
try {
    & powershell.exe -ExecutionPolicy Bypass -NonInteractive `
        -File "C:\mailtrustai-source\scripts\backup\backup-customer-windows.ps1" `
        -TargetDir "C:\MailTrustAI\backups\auto-weekly"
} finally {
    Stop-Transcript
}
