# Run one aside exec measurement (020 D3). Usage: run-task.ps1 -Needle NEEDLE-A3 -Label after [-Probe]
param([string]$Needle = 'NEEDLE-A3', [string]$Label = 'after', [switch]$Probe)
$aside = Join-Path $env:LOCALAPPDATA 'Aside/CLI/current/aside.exe'
if (-not (Test-Path -LiteralPath $aside)) {
  $aside = Get-ChildItem "$env:LOCALAPPDATA/Aside/CLI/versions/*/aside.exe" | Sort-Object FullName | Select-Object -Last 1 -ExpandProperty FullName
}
$repo = Split-Path $PSScriptRoot -Parent
$ev = Join-Path $repo 'evidence'
New-Item -ItemType Directory -Force $ev | Out-Null
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$dump = Join-Path $ev "$ts-$Label.jsonl"
if ($Probe) {
  $prompt = 'execute_code MCP 툴이 보이면 그걸로 return 40+2 만 실행하고 결과만 답하라. 다른 도구는 쓰지 마라. Do not ask me any questions.'
} else {
  $prompt = "C:/Users/super/.aside/u/0/codemode-eval/corpus 아래에서 $Needle 가 들어있는 파일을 모두 찾아 절대경로로 보고하라. 찾은 각 경로를 한 줄에 하나씩 적어라. Write and edit files only under C:/Users/super/.aside/u/0. Read other local paths only when this prompt names them, and never modify them. This prompt names C:/Users/super/.aside/u/0/codemode-eval as readable. Downloading to C:/Users/super/Downloads is fine; move anything you keep under C:/Users/super/.aside/u/0. Do not ask me any questions. If something is blocked or ambiguous, pick the most reasonable option and continue, or report exactly what blocked you and stop."
}
$out = Join-Path $env:TEMP 'aside-eval-out.txt'; $err = Join-Path $env:TEMP 'aside-eval-err.txt'
$p = Start-Process -FilePath $aside -PassThru -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError $err -ArgumentList @('exec','--permission','full-access','--log-dump',$dump,'--', $prompt)
if (-not $p.WaitForExit(600000)) { & "$env:SystemRoot/System32/taskkill.exe" /PID $p.Id /T /F | Out-Null; Write-Output 'TIMEOUT142'; exit 142 }
Write-Output "DUMP=$dump"
Get-Content $out -Raw
Write-Output '---STDERR(tail)---'
Get-Content $err -Raw | Select-Object -Last 3
Write-Output ('EXIT=' + $p.ExitCode)
