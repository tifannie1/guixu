$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
Add-Type -Path (Join-Path $PSScriptRoot 'foreground.cs')

while ($null -ne ($line = [Console]::ReadLine())) {
    $request = $null
    try {
        $request = ConvertFrom-Json -InputObject $line
        $context = [GuixuForeground]::Read([uint32]$request.ownerPid)
        $reply = @{ id = $request.id; ok = $true; value = $context }
    } catch {
        $reply = @{ id = $request.id; ok = $false }
    }
    [Console]::WriteLine((ConvertTo-Json -InputObject $reply -Compress))
}
