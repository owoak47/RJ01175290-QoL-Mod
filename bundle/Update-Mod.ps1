param([string]$GamePath='', [string]$LocalPackage='', [string]$ExpectedSha256='', [string]$UpdaterHome='', [switch]$NoShortcut)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$repo='owoak47/RJ01175290-QoL-Mod'
$assetName='RJ01175290-QoL-Mod.zip'
$work=$null
function Read-Json($p) { return ([IO.File]::ReadAllText($p,[Text.Encoding]::UTF8)|ConvertFrom-Json) }
function Safe-Path($root,$relative) {
    $r=[IO.Path]::GetFullPath($root).TrimEnd('\')
    $p=[IO.Path]::GetFullPath((Join-Path $r $relative))
    if(-not $p.StartsWith($r+'\',[StringComparison]::OrdinalIgnoreCase)){throw '更新套件路徑不合法。'}
    return $p
}
function File-Hash($p) { return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }
function Run-Manager($bundle,$action) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $bundle 'Manage-Mod.ps1') -Action $action -GamePath $GamePath
    if($LASTEXITCODE -ne 0){throw ('Mod '+$action+' 失敗。')}
}
try {
    $settingsPath=Join-Path $PSScriptRoot 'updater-settings.json'
    if(-not $GamePath -and (Test-Path -LiteralPath $settingsPath)){$GamePath=(Read-Json $settingsPath).gamePath}
    if(-not $GamePath){$GamePath=Read-Host '首次使用：請貼上 Game.exe 所在資料夾'}
    $GamePath=(Resolve-Path -LiteralPath $GamePath.Trim().Trim('"')).Path
    if(Test-Path -LiteralPath $GamePath -PathType Leaf){$GamePath=Split-Path -LiteralPath $GamePath}
    $www=$null
    foreach($p in @((Join-Path $GamePath 'bin\www'),(Join-Path $GamePath 'www'),$GamePath)) {
        if((Test-Path -LiteralPath (Join-Path $p 'js\plugins.js')) -and (Test-Path -LiteralPath (Join-Path $p 'data\System.json'))){$www=[IO.Path]::GetFullPath($p);break}
    }
    if(-not $www){throw '找不到遊戲資料夾。'}
    $running=@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith(([IO.Directory]::GetParent($www).FullName+'\'),[StringComparison]::OrdinalIgnoreCase) -and $_.Name -in @('nw.exe','Game.exe')})
    if($running.Count){throw '請先儲存並正常關閉遊戲，再更新 Mod。'}
    if([IO.File]::ReadAllText((Join-Path $www 'js\rmmz_objects.js')) -match '_local(?:TeaTicket|Temperance|AsabaStrawberry)Locked'){throw '偵測到不相容的遊戲程式修改，已取消更新。'}
    $work=Join-Path ([IO.Path]::GetTempPath()) ('RJ-QoL-Update-'+[guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($work)
    $archive=Join-Path $work 'update.zip'
    $release=$null
    if($LocalPackage) {
        if($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$'){throw '本機測試套件必須指定 SHA256。'}
        Copy-Item -LiteralPath $LocalPackage -Destination $archive
    } else {
        [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
        try {$release=Invoke-RestMethod -Uri ('https://api.github.com/repos/'+$repo+'/releases/latest') -Headers @{'User-Agent'='RJ-QoL-Updater';'Accept'='application/vnd.github+json'} -TimeoutSec 30}
        catch {throw '無法取得更新。請確認網路及 GitHub Releases 是否已發布朋友版；遊戲未修改。'}
        $asset=@($release.assets|Where-Object {$_.name -eq $assetName})
        if($asset.Count -ne 1 -or $asset[0].size -gt 5242880){throw '找不到有效的朋友版更新檔。'}
        $download=$asset[0].browser_download_url
        if(-not $download.StartsWith('https://github.com/'+$repo+'/releases/download/',[StringComparison]::Ordinal)){throw '下載來源不符。'}
        if($asset[0].digest -notmatch '^sha256:([a-fA-F0-9]{64})$'){throw 'Release 缺少 GitHub SHA256 校驗，未修改遊戲。'}
        $ExpectedSha256=$Matches[1]
        Invoke-WebRequest -UseBasicParsing -Uri $download -OutFile $archive -TimeoutSec 60
    }
    if((File-Hash $archive) -ne $ExpectedSha256.ToLowerInvariant()){throw '下載校驗失敗，未修改遊戲。'}
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $extract=Join-Path $work 'package'
    [void][IO.Directory]::CreateDirectory($extract)
    $zip=[IO.Compression.ZipFile]::OpenRead($archive)
    try {
        $total=0
        foreach($entry in $zip.Entries) {
            $total+=$entry.Length
            if($total -gt 10485760 -or $entry.FullName -match '(^|[/\\])\.\.([/\\]|$)' -or $entry.FullName.Contains(':')){throw '更新壓縮檔內容不合法。'}
            [void](Safe-Path $extract $entry.FullName)
        }
    } finally {$zip.Dispose()}
    [IO.Compression.ZipFile]::ExtractToDirectory($archive,$extract)
    $manifests=@(Get-ChildItem -LiteralPath $extract -Filter manifest.json -Recurse -File)
    if($manifests.Count -ne 1){throw '更新套件格式錯誤。'}
    $bundle=$manifests[0].Directory.FullName
    $manifest=Read-Json $manifests[0].FullName
    if($manifest.id -ne 'RJ01175290-QoL-Mod' -or $manifest.version -notmatch '^\d+\.\d+\.\d+$'){throw '無法辨識 Mod 版本。'}
    if($release -and $release.tag_name -ne ('v'+$manifest.version)){throw 'Release 與套件版本不符。'}
    $title=(Read-Json (Join-Path $www 'data\System.json')).gameTitle
    $supported=@($manifest.gameVersions|Where-Object {$title -match ('ver'+[regex]::Escape($_)+'(?:\s|$)')})
    if($supported.Count -ne 1){throw ('這個遊戲版本尚未支援：'+$title+'。遊戲未修改。')}
    $checksums=Join-Path $bundle 'SHA256SUMS.txt'
    foreach($line in [IO.File]::ReadAllLines($checksums)) {
        if($line -notmatch '^([a-f0-9]{64})  (.+)$'){throw '套件校驗清單錯誤。'}
        if((File-Hash (Safe-Path $bundle $Matches[2])) -ne $Matches[1]){throw '套件內部校驗失敗。'}
    }
    $statePath=Join-Path $www '.rj-qol-mod.json'
    $state=$null
    if(Test-Path -LiteralPath $statePath){$state=Read-Json $statePath}
    if($state -and ($state.id -ne $manifest.id -or $state.schema -ne 1)){throw '既有安裝紀錄不相容。'}
    $intact=$false
    if($state) {
        $intact=$true
        foreach($e in $state.files){$p=Safe-Path $www $e.path;if(-not (Test-Path -LiteralPath $p) -or (File-Hash $p) -ne $e.installedSha256){$intact=$false;break}}
    }
    # 包含卸載與安裝在內的交易：失敗時還原更新前檔案，不碰 save。
    $paths=@('js/plugins.js','.rj-qol-mod.json')+@($manifest.patches|ForEach-Object {$_.path})+@($manifest.modules|ForEach-Object {'js/plugins/'+$_.name+'.js'})
    if($state){$paths+=@($state.files|ForEach-Object {$_.path})}
    $snapshot=@()
    foreach($relative in ($paths|Select-Object -Unique)) {
        if($relative -notmatch '^(js/|\.rj-qol-mod\.json$)'){throw '更新範圍不合法。'}
        $p=Safe-Path $www $relative
        $exists=Test-Path -LiteralPath $p
        $snapshot+=@{path=$p;existed=$exists;bytes=$(if($exists){[IO.File]::ReadAllBytes($p)}else{$null})}
    }
    try {
        if($intact -and $state.version -ne $manifest.version){Run-Manager $bundle 'Uninstall'}
        Run-Manager $bundle 'Install'
    } catch {
        foreach($e in $snapshot) {
            if($e.existed){[IO.File]::WriteAllBytes($e.path,$e.bytes)}
            elseif(Test-Path -LiteralPath $e.path){Remove-Item -LiteralPath $e.path -Force}
        }
        throw ('更新取消，已還原更新前狀態：'+$_.Exception.Message)
    }
    # 更新器保留獨立副本，之後不用再傳檔案；自己的更新在交易成功後進行。
    $updaterRoot=if($UpdaterHome){[IO.Path]::GetFullPath($UpdaterHome)}else{Join-Path $env:LOCALAPPDATA 'RJ01175290-QoL-Updater'}
    [void][IO.Directory]::CreateDirectory($updaterRoot)
    foreach($name in @('Update-Mod.ps1','Update.cmd')) {
        $source=Join-Path $bundle $name
        if(Test-Path -LiteralPath $source){Copy-Item -LiteralPath $source -Destination (Join-Path $updaterRoot $name) -Force}
    }
    $settings=@{gamePath=$GamePath}|ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $updaterRoot 'updater-settings.json'),$settings,(New-Object Text.UTF8Encoding($false)))
    if(-not $NoShortcut){
        $shell=New-Object -ComObject WScript.Shell
        $shortcut=$shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) '更新朋友版 Mod.lnk'))
        $shortcut.TargetPath=Join-Path $updaterRoot 'Update.cmd'
        $shortcut.WorkingDirectory=$updaterRoot
        $shortcut.Save()
    }
    Write-Output ('完成：Mod '+$manifest.version+'。之後請按桌面的「更新朋友版 Mod」。')
    exit 0
} catch { Write-Output ('失敗：'+$_.Exception.Message);exit 1 }
finally {
    if($work -and [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($work)) -eq [IO.Path]::GetTempPath().TrimEnd('\') -and [IO.Path]::GetFileName($work) -like 'RJ-QoL-Update-*') {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}
