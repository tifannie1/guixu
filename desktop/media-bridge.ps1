$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.GetGenericTypeDefinition().FullName -eq 'Windows.Foundation.IAsyncOperation' + [char]96 + '1'
} | Select-Object -First 1

function Await-Result($operation, [type]$resultType) {
    $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
    if (!$task.Wait(2500)) { throw 'Windows media operation timed out.' }
    $task.GetAwaiter().GetResult()
}

$manager = Await-Result ($managerType::RequestAsync()) $managerType
$heldSource = ''
$holdUntil = [DateTime]::MinValue
$hasVolume = $false
try {
    Add-Type -Path (Join-Path $PSScriptRoot 'system-volume.cs')
    $hasVolume = $true
} catch {}

function Find-MediaSession([string]$source) {
    $current = $manager.GetCurrentSession()
    if ($source -and $current -and $current.SourceAppUserModelId -ceq $source) { return $current }
    $fallback = $null
    $playing = $null
    if (!$source -and $current) {
        $status = $current.GetPlaybackInfo().PlaybackStatus.ToString()
        if ($status -eq 'Playing') { $playing = $current }
        if ($status -notin @('Closed', 'Stopped')) { $fallback = $current }
    }
    foreach ($candidate in $manager.GetSessions()) {
        if ($source) {
            if ($candidate.SourceAppUserModelId -ceq $source) { return $candidate }
        } else {
            $status = $candidate.GetPlaybackInfo().PlaybackStatus.ToString()
            if ($status -notin @('Closed', 'Stopped') -and $candidate.SourceAppUserModelId -match '(?i)cloudmusic|netease') {
                return $candidate
            }
            if ($status -eq 'Playing') {
                if ($null -eq $playing) { $playing = $candidate }
            }
            if ($null -eq $fallback -and $status -notin @('Closed', 'Stopped')) { $fallback = $candidate }
        }
    }
    if ($playing) { return $playing }
    return $fallback
}

function Get-VolumeState {
    if ($hasVolume) {
        try {
            $volume = [GuixuSystemVolume]::Read()
            return @{ level = [int][Math]::Round($volume.Level * 100); muted = [bool]$volume.Muted }
        } catch {}
    }
    return $null
}

function Get-MediaState {
    $session = if ([DateTime]::UtcNow -lt $holdUntil) { Find-MediaSession $heldSource }
    if ($session -and $session.GetPlaybackInfo().PlaybackStatus.ToString() -in @('Closed', 'Stopped')) { $session = $null }
    if ($null -eq $session) { $session = Find-MediaSession '' }
    $volume = Get-VolumeState
    if ($null -eq $session) { return @{ hasSession = $false; volume = $volume } }
    $playback = $session.GetPlaybackInfo()
    $controls = $playback.Controls
    $status = $playback.PlaybackStatus.ToString()
    $state = @{
        hasSession = $true
        source = [string]$session.SourceAppUserModelId
        title = ''
        artist = ''
        playing = ($status -eq 'Playing')
        canPlay = ($controls.IsPlayEnabled -or $controls.IsPlayPauseToggleEnabled)
        canPause = ($controls.IsPauseEnabled -or $controls.IsPlayPauseToggleEnabled)
        canPrevious = [bool]$controls.IsPreviousEnabled
        canNext = [bool]$controls.IsNextEnabled
        timeline = $null
        volume = $volume
    }
    try {
        $media = Await-Result ($session.TryGetMediaPropertiesAsync()) $propertiesType
        $state.title = [string]$media.Title
        $state.artist = [string]$media.Artist
    } catch {}
    try {
        $timeline = $session.GetTimelineProperties()
        [double]$start = $timeline.StartTime.TotalSeconds
        [double]$duration = $timeline.EndTime.TotalSeconds - $start
        if ($duration -gt 0) {
            [double]$position = $timeline.Position.TotalSeconds - $start
            $sinceUpdate = ([DateTimeOffset]::UtcNow - $timeline.LastUpdatedTime).TotalSeconds
            if ($state.playing -and $sinceUpdate -gt 0 -and $sinceUpdate -le $duration) {
                [double]$rate = 1
                try {
                    [double]$reportedRate = $playback.PlaybackRate
                    if ($reportedRate -gt 0) { $rate = $reportedRate }
                } catch {}
                $position += $sinceUpdate * $rate
            }
            $state.timeline = @{
                position = [Math]::Round([Math]::Max(0.0, [Math]::Min($duration, $position)), 1)
                duration = [Math]::Round($duration, 1)
                canSeek = [bool]$controls.IsPlaybackPositionEnabled
            }
        }
    } catch {}
    return $state
}

function Invoke-MediaCommand($request) {
    if ($request.action -eq 'state') { return (Get-MediaState) }
    if ($request.action -eq 'volume') {
        return ($hasVolume -and [GuixuSystemVolume]::SetLevel([single]($request.value / 100)))
    }
    if ($request.action -eq 'mute') {
        return ($hasVolume -and [GuixuSystemVolume]::SetMute([bool]$request.value))
    }
    $session = Find-MediaSession $request.source
    if ($null -eq $session -or $session.SourceAppUserModelId -cne $request.source) { return $false }
    $playback = $session.GetPlaybackInfo()
    $controls = $playback.Controls
    switch ($request.action) {
        'play' {
            if ($playback.PlaybackStatus.ToString() -eq 'Playing') { return $true }
            if ($controls.IsPlayEnabled) { return (Await-Result ($session.TryPlayAsync()) ([bool])) }
            if ($controls.IsPlayPauseToggleEnabled) { return (Await-Result ($session.TryTogglePlayPauseAsync()) ([bool])) }
        }
        'pause' {
            if ($playback.PlaybackStatus.ToString() -eq 'Paused') { return $true }
            if ($controls.IsPauseEnabled) { return (Await-Result ($session.TryPauseAsync()) ([bool])) }
            if ($controls.IsPlayPauseToggleEnabled) { return (Await-Result ($session.TryTogglePlayPauseAsync()) ([bool])) }
        }
        'previous' {
            if ($controls.IsPreviousEnabled) { return (Await-Result ($session.TrySkipPreviousAsync()) ([bool])) }
        }
        'next' {
            if ($controls.IsNextEnabled) { return (Await-Result ($session.TrySkipNextAsync()) ([bool])) }
        }
        'seek' {
            if (!$controls.IsPlaybackPositionEnabled) { return $false }
            $timeline = $session.GetTimelineProperties()
            $start = [Math]::Max($timeline.StartTime.TotalSeconds, $timeline.MinSeekTime.TotalSeconds)
            $end = $timeline.EndTime.TotalSeconds
            if ($timeline.MaxSeekTime.TotalSeconds -gt $start) {
                $end = [Math]::Min($end, $timeline.MaxSeekTime.TotalSeconds)
            }
            if ($end -lt $start) { return $false }
            $position = [Math]::Min($end, [Math]::Max($start, $timeline.StartTime.TotalSeconds + $request.value))
            return (Await-Result ($session.TryChangePlaybackPositionAsync([long]($position * 10000000))) ([bool]))
        }
    }
    return $false
}

while ($null -ne ($line = [Console]::ReadLine())) {
    $request = $null
    try {
        $request = ConvertFrom-Json -InputObject $line
        $value = Invoke-MediaCommand $request
        if ($request.action -eq 'pause' -and $value) {
            $heldSource = $request.source
            $holdUntil = [DateTime]::UtcNow.AddSeconds(90)
        } elseif ($request.action -eq 'play' -and $value) {
            $holdUntil = [DateTime]::UtcNow.AddSeconds(3)
        }
        $reply = @{ id = $request.id; ok = $true; value = $value }
    } catch {
        $reply = @{ id = $request.id; ok = $false }
    }
    [Console]::WriteLine((ConvertTo-Json -InputObject $reply -Depth 5 -Compress))
}
