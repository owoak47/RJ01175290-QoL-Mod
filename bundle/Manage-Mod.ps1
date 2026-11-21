param(
    [ValidateSet('Install','Uninstall')][string]$Action = 'Install',
    [string]$GamePath = '',
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$Utf8 = New-Object Text.UTF8Encoding($false)
$Bundle = $PSScriptRoot
[void][Reflection.Assembly]::LoadWithPartialName('System.Web.Extensions')
$Json = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$Json.MaxJsonLength = 2147483647
$Json.RecursionLimit = 100

function Hash-Bytes([byte[]]$Bytes) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}
function Read-Text([string]$Path) { return [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8).TrimStart([char]0xfeff) }
function Normalize([string]$Text) { return $Text.Replace("`r`n","`n") }
function Safe-Path([string]$Root, [string]$Relative) {
    $full = [IO.Path]::GetFullPath((Join-Path $Root $Relative))
    if (-not $full.StartsWith($Root.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw '套件含有不合法路徑。' }
    return $full
}
function Write-Bytes([string]$Path, [byte[]]$Bytes) {
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Path)) | Out-Null
    [IO.File]::WriteAllBytes($Path, $Bytes)
}
try {
    if (-not $GamePath) { $GamePath = Read-Host '請貼上遊戲資料夾路徑（Game.exe 所在資料夾）' }
    $GamePath = $GamePath.Trim().Trim('"')
    if (Test-Path -LiteralPath $GamePath -PathType Leaf) { $GamePath = Split-Path -LiteralPath $GamePath }
    $GamePath = (Resolve-Path -LiteralPath $GamePath).Path
    $www = $null
    foreach ($candidate in @((Join-Path $GamePath 'bin\www'),(Join-Path $GamePath 'www'),$GamePath)) {
        if ((Test-Path -LiteralPath (Join-Path $candidate 'js\plugins.js')) -and (Test-Path -LiteralPath (Join-Path $candidate 'data\System.json'))) {
            $www = [IO.Path]::GetFullPath($candidate).TrimEnd('\'); break
        }
    }
    if (-not $www) { throw '找不到解包式 RPG Maker MZ 遊戲資料夾。請選擇 Game.exe 所在資料夾。' }
    $statePath = Join-Path $www '.rj-qol-mod.json'
    $running = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith(([IO.Directory]::GetParent($www).FullName+'\'),[StringComparison]::OrdinalIgnoreCase) -and $_.Name -in @('nw.exe','Game.exe')
    })
    if ($running.Count -gt 0) { throw '請先正常關閉這份遊戲，再安裝或還原。' }

    if ($Action -eq 'Uninstall') {
        if (-not (Test-Path -LiteralPath $statePath)) { throw '這份遊戲沒有本套件的安裝紀錄，未修改任何檔案。' }
        $state = Read-Text $statePath | ConvertFrom-Json
        if ($state.id -ne 'RJ01175290-QoL-Mod' -or $state.schema -ne 1) { throw '安裝紀錄不相容。' }
        $backup = Safe-Path $www $state.backup
        foreach ($entry in $state.files) {
            $target = Safe-Path $www $entry.path
            if (-not (Test-Path -LiteralPath $target) -or (Hash-Bytes ([IO.File]::ReadAllBytes($target))) -ne $entry.installedSha256) {
                throw ('遊戲更新或其他修改已變更 '+$entry.path+'；為避免覆蓋新檔，未執行還原。')
            }
            if ($entry.existed) {
                $original = Safe-Path $backup ('files/'+$entry.path)
                if ((Hash-Bytes ([IO.File]::ReadAllBytes($original))) -ne $entry.originalSha256) { throw '備份校驗失敗，未執行還原。' }
            }
        }
        if ($CheckOnly) { Write-Output 'PASS：可安全還原。'; exit 0 }
        $completed = New-Object Collections.Generic.List[object]
        try {
            foreach ($entry in $state.files) {
                $target = Safe-Path $www $entry.path
                $completed.Add(@{path=$target;bytes=[IO.File]::ReadAllBytes($target)})
                if ($entry.existed) { Write-Bytes $target ([IO.File]::ReadAllBytes((Safe-Path $backup ('files/'+$entry.path)))) }
                else { Remove-Item -LiteralPath $target -Force }
            }
            Remove-Item -LiteralPath $statePath -Force
        } catch {
            foreach ($entry in $completed) { Write-Bytes $entry.path $entry.bytes }
            throw
        }
        Write-Output '已還原安裝前的程式與插件清單。存檔與遊戲進度沒有回退。'
        exit 0
    }

    $manifest = Read-Text (Join-Path $Bundle 'manifest.json') | ConvertFrom-Json
    $system = $Json.DeserializeObject((Read-Text (Join-Path $www 'data\System.json')))
    $matchedVersion = $null
    foreach ($version in $manifest.gameVersions) {
        if ($system.gameTitle -match ('ver'+[regex]::Escape($version)+'(?:\s|$)')) { $matchedVersion = $version; break }
    }
    if (-not $matchedVersion) {
        throw ('目前支援 '+($manifest.gameVersions -join '、')+'，這份遊戲顯示：'+$system.gameTitle+'。未修改檔案。')
    }
    $setProperty = $manifest.patchSets.PSObject.Properties[$matchedVersion]
    if (-not $setProperty) { throw '套件缺少這個遊戲版本的修補資料。' }
    $manifest.patches = @($setProperty.Value)
    $previousStateBytes = $null
    if (Test-Path -LiteralPath $statePath) {
        $previousStateBytes = [IO.File]::ReadAllBytes($statePath)
        $state = Read-Text $statePath | ConvertFrom-Json
        if ($state.id -ne 'RJ01175290-QoL-Mod' -or $state.schema -ne 1) { throw '無法辨識既有安裝紀錄，未修改檔案。' }
        $unchanged = $true
        foreach ($entry in $state.files) {
            $target = Safe-Path $www $entry.path
            if (-not (Test-Path -LiteralPath $target) -or (Hash-Bytes ([IO.File]::ReadAllBytes($target))) -ne $entry.installedSha256) { $unchanged = $false; break }
        }
        if ($unchanged) {
            if ($state.version -eq $manifest.version) { Write-Output '已安裝相同版本，校驗通過，不重複修改。'; exit 0 }
            throw '舊版Mod仍完整。請先執行Uninstall.cmd，再安裝新版；還原工具支援舊版紀錄。'
        }
        # 更新器已完整恢復七個原版腳本時，重新以更新後版本建立備份。
        # 任何一個腳本仍是未知內容或只更新一半，都拒絕覆蓋。
        foreach ($patch in $manifest.patches) {
            $target = Safe-Path $www $patch.path
            if (-not (Test-Path -LiteralPath $target) -or (Hash-Bytes ($Utf8.GetBytes((Normalize (Read-Text $target))))) -ne $patch.beforeSha256) {
                throw '既有Mod已被部分修改或更新，未覆寫。請使用完整一般版副本安裝。'
            }
        }
        Write-Output '偵測到遊戲更新已恢復原版腳本，將重新檢查並以更新後檔案建立備份。'
    }
    $engine = Read-Text (Join-Path $www 'js\rmmz_objects.js')
    if ($engine -match '_local(?:TeaTicket|Temperance|AsabaStrawberry)Locked') {
        throw '偵測到自用固定數量版本。為保留你的設定，拒絕安裝；請改用一般版遊戲副本。'
    }
    $writes = New-Object Collections.Generic.List[object]
    foreach ($patch in $manifest.patches) {
        $target = Safe-Path $www $patch.path
        $bytes = [IO.File]::ReadAllBytes($target)
        $raw = Read-Text $target
        $text = Normalize $raw
        $hash = Hash-Bytes ($Utf8.GetBytes($text))
        if ($hash -ne $patch.beforeSha256 -and $hash -ne $patch.afterSha256) {
            throw ('不支援的檔案版本或其他Mod修改：'+$patch.path+'。整個安裝已取消，未改檔。')
        }
        if ($hash -eq $patch.beforeSha256) {
            foreach ($change in $patch.changes) {
                if (([regex]::Matches($text,[regex]::Escape($change.before))).Count -ne 1) { throw ('修補位置不唯一：'+$patch.path) }
                $text = $text.Replace($change.before,$change.after)
            }
            if ((Hash-Bytes ($Utf8.GetBytes($text))) -ne $patch.afterSha256) { throw ('修補結果校驗失敗：'+$patch.path) }
        }
        if ($raw.Contains("`r`n")) { $text = $text.Replace("`n","`r`n") }
        $writes.Add(@{path=$patch.path;target=$target;before=$bytes;after=$Utf8.GetBytes($text);existed=$true})
    }
    foreach ($module in $manifest.modules) {
        $source = Safe-Path $Bundle ('plugins/'+$module.name+'.js')
        $after = [IO.File]::ReadAllBytes($source)
        if ((Hash-Bytes $after) -ne $module.sha256) { throw ('套件插件校驗失敗：'+$module.name) }
        $relative = 'js/plugins/'+$module.name+'.js'
        $target = Safe-Path $www $relative
        $exists = Test-Path -LiteralPath $target
        $before = $null
        if ($exists) {
            $before = [IO.File]::ReadAllBytes($target)
            if ((Hash-Bytes $before) -ne $module.sha256 -and @($module.acceptedPreviousSha256) -notcontains (Hash-Bytes $before)) { throw ('已有不同版本的插件：'+$module.name+'，未覆蓋。') }
        }
        $writes.Add(@{path=$relative;target=$target;before=$before;after=$after;existed=$exists})
    }
    $configPath = Join-Path $www 'js\plugins.js'
    $configBefore = [IO.File]::ReadAllBytes($configPath)
    $configText = Read-Text $configPath
    $match = [regex]::Match($configText,'(?s)^(.*?)var\s+\$plugins\s*=\s*(\[.*\])\s*;?\s*$')
    if (-not $match.Success) { throw '無法辨識插件清單格式。' }
    $entries = @($Json.DeserializeObject($match.Groups[2].Value))
    $names = @($manifest.modules | ForEach-Object {$_.name})
    foreach ($required in @('StandaloneEquipScene','StandaloneItemScene','QJ-MPMZLib-Item','QJ-MPMZLib-DamagePipeline')) {
        if (-not @($entries | Where-Object {$_.name -eq $required -and $_.status}).Count) { throw ('缺少啟用的必要插件：'+$required) }
    }
    $plugins = New-Object Collections.Generic.List[object]
    foreach ($entry in $entries) { if ($names -notcontains $entry.name) { $plugins.Add($entry) } }
    $index = $plugins.Count
    for ($i=0;$i -lt $plugins.Count;$i++) { if ($plugins[$i].name -eq 'Shiroin_OffscreenSpriteCull') { $index=$i;break } }
    foreach ($module in $manifest.modules) {
        $plugins.Insert($index,@{name=$module.name;status=$true;description='RJ QoL Mod 1.0.10';parameters=@{}})
        $index++
    }
    $lines = @($plugins | ForEach-Object { $Json.Serialize($_) })
    $configAfter = $Utf8.GetBytes($match.Groups[1].Value+"var `$plugins = [`n"+($lines -join ",`n")+"`n];`n")
    $writes.Add(@{path='js/plugins.js';target=$configPath;before=$configBefore;after=$configAfter;existed=$true})
    if ($CheckOnly) { Write-Output ('PASS：一般版相容檢查通過，將安裝'+$manifest.modules.Count+'個插件，差異修補'+$manifest.patches.Count+'個檔案。');exit 0 }

    $relativeBackup = '.rj-qol-backups/'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
    $backup = Safe-Path $www $relativeBackup
    if ($previousStateBytes) { Write-Bytes (Join-Path $backup 'previous-installation.json') $previousStateBytes }
    $records = New-Object Collections.Generic.List[object]
    foreach ($entry in $writes) {
        if ($entry.existed) { Write-Bytes (Safe-Path $backup ('files/'+$entry.path)) $entry.before }
        $records.Add(@{path=$entry.path;existed=$entry.existed;originalSha256=$(if($entry.existed){Hash-Bytes $entry.before}else{$null});installedSha256=(Hash-Bytes $entry.after)})
    }
    $state = @{id='RJ01175290-QoL-Mod';schema=1;version=$manifest.version;gameVersion=$matchedVersion;backup=$relativeBackup;files=@($records.ToArray())}
    Write-Bytes (Join-Path $backup 'installation.json') ($Utf8.GetBytes((ConvertTo-Json -InputObject $state -Depth 10)))
    $changed = New-Object Collections.Generic.List[object]
    try {
        foreach ($entry in $writes) {
            if ($entry.existed -and (Hash-Bytes ([IO.File]::ReadAllBytes($entry.target))) -ne (Hash-Bytes $entry.before)) { throw ('安裝期間檔案被其他程式變更：'+$entry.path) }
            if (-not $entry.existed -and (Test-Path -LiteralPath $entry.target)) { throw ('安裝期間出現同名檔案：'+$entry.path) }
            $changed.Add($entry)
            Write-Bytes $entry.target $entry.after
            if ((Hash-Bytes ([IO.File]::ReadAllBytes($entry.target))) -ne (Hash-Bytes $entry.after)) { throw ('寫入校驗失敗：'+$entry.path) }
        }
        Write-Bytes $statePath ($Utf8.GetBytes((ConvertTo-Json -InputObject $state -Depth 10)))
    } catch {
        foreach ($entry in $changed) {
            if ($entry.existed) { Write-Bytes $entry.target $entry.before }
            elseif (Test-Path -LiteralPath $entry.target) { Remove-Item -LiteralPath $entry.target -Force }
        }
        throw
    }
    Write-Output ('安裝完成：'+$www)
    Write-Output ('備份：'+$backup)
    Write-Output '請正常啟動Game.exe。套件沒有修改任何存檔，也沒有固定物品數量功能。'
    exit 0
} catch {
    Write-Output ('失敗：'+$_.Exception.Message)
    exit 1
}
