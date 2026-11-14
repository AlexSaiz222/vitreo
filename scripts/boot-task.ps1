# The sign-in task (D94): a minute after you sign in to Windows, and then
# every 30 minutes while you stay signed in, it runs
# `pnpm status --repair`, which starts Docker Desktop (its own AutoStart
# stays off, docs/05), waits for it and restarts any
# container whose port does not answer. What it did goes to data/status.log.
#
# It runs in a console without a window (conhost --headless). With
# `powershell -WindowStyle Hidden`, Windows Terminal opened a visible window
# anyway, and closing it killed the run: on 2026-10-19 that left Docker off
# for three and a half days.
#
#   pnpm boot:install    create (or update) the task, for this user only
#   pnpm boot:remove     delete it
#
# No administrator rights: the task runs as you, only while you are signed in.
param([switch]$Remove)

$name = 'Vitreo after sign-in'
if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Removed the task '$name'."
  exit 0
}

$repo = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $repo 'scripts\status.mjs'
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\conhost.exe" `
  -Argument "--headless `"$node`" `"$script`" --repair" -WorkingDirectory $repo
$atLogOn = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$atLogOn.Delay = 'PT1M'
# Every 30 minutes from now on, with no end, whenever you are signed in. A
# repetition on the sign-in trigger itself would only start at the next
# sign-in, leaving the session in course unwatched.
$every = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 30)
# A run still going when the next one is due: the next one is skipped.
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $action -Trigger @($atLogOn, $every) -Settings $settings `
  -Principal $principal -Description 'Vitreo: after sign-in and every 30 minutes, starts Docker if needed, checks the hub, the simulator and the app, and mends dead ports (pnpm status --repair).' -Force | Out-Null
Write-Output "Task '$name' ready: a minute after each sign-in, then every 30 minutes, it runs pnpm status --repair (log: data\status.log)."
