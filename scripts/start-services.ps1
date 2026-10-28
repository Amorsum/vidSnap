$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$port = 3100
$serverUrl = "http://127.0.0.1:$port/"
$configPath = Join-Path $projectRoot 'cloudflared-config.yml'
$tunnelPath = Join-Path $projectRoot 'cloudflared.exe'
$logDirectory = Join-Path $projectRoot 'tmp\deployment'

function Test-VidSnap {
    # 绕过系统代理并核对应用标识，防止把其他服务的响应当成启动成功。
    $page = & curl.exe --noproxy '*' --fail --silent --max-time 3 $serverUrl
    return ($LASTEXITCODE -eq 0 -and ($page -join "`n") -match '<title>VidSnap(?:\s|<)')
}

try {
    foreach ($requiredPath in @($configPath, $tunnelPath, (Join-Path $projectRoot '.next\BUILD_ID'))) {
        if (-not (Test-Path -LiteralPath $requiredPath)) {
            throw "Missing required file: $requiredPath"
        }
    }
    if (-not (Select-String -LiteralPath $configPath -Pattern '^\s*service:\s*http://127\.0\.0\.1:3100\s*$' -Quiet)) {
        throw 'Tunnel origin must be http://127.0.0.1:3100 in cloudflared-config.yml.'
    }

    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    if (-not (Test-VidSnap)) {
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
        if ($listeners.Count -gt 0) {
            throw "Port $port is occupied by another or unhealthy service. No process was stopped."
        }

        $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
        $server = Start-Process -FilePath $nodePath -ArgumentList @(
            'node_modules/next/dist/bin/next', 'start', '-p', "$port", '-H', '127.0.0.1'
        ) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $logDirectory 'server.log') `
            -RedirectStandardError (Join-Path $logDirectory 'server-error.log')

        $ready = $false
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            if (Test-VidSnap) {
                $ready = $true
                break
            }
            $server.Refresh()
            if ($server.HasExited) {
                throw "VidSnap exited before becoming ready. See $logDirectory."
            }
            Start-Sleep -Seconds 2
        }
        if (-not $ready) {
            throw "VidSnap did not become ready. Tunnel was not started. See $logDirectory."
        }
    }

    # 按本项目配置匹配，重复启动时复用已有隧道连接器。
    $existingTunnel = @(Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" |
        Where-Object { $_.CommandLine -match [regex]::Escape($configPath) })
    if ($existingTunnel.Count -eq 0) {
        Start-Process -FilePath $tunnelPath -ArgumentList @(
            'tunnel', '--config', ('"' + $configPath + '"'), 'run'
        ) -WorkingDirectory $projectRoot -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $logDirectory 'tunnel.log') `
            -RedirectStandardError (Join-Path $logDirectory 'tunnel-error.log')
        Write-Output 'VidSnap is ready; Cloudflare Tunnel was launched.'
    } else {
        Write-Output 'VidSnap is ready; existing Cloudflare Tunnel was kept.'
    }
    Write-Output "Local origin: $serverUrl"
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
}
