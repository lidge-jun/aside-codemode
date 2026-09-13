$ErrorActionPreference = 'Stop'
$node = 'C:/nvm4w/nodejs/node.exe'
if (-not (Test-Path -LiteralPath $node)) { $node = (Get-Command node -ErrorAction Stop).Source }
& $node (Join-Path $PSScriptRoot 'register-aside.mjs')
exit $LASTEXITCODE
