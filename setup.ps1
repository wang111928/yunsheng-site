# 把站点里的占位域名替换成真实域名
# 用法： .\setup.ps1 -Domain "ys.example.xyz"
param(
    [Parameter(Mandatory = $true)]
    [string]$Domain
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pub = Join-Path $root 'public'
$placeholder = 'yunsheng.example.xyz'
$domain = $Domain.Trim().TrimEnd('/')
$domain = $domain -replace '^https?://', ''

if ($domain -notmatch '^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$') {
    Write-Error "域名格式看起来不对：$domain"
}

$targets = @('index.html', 'robots.txt', 'sitemap.xml')
$changed = 0
$utf8 = New-Object System.Text.UTF8Encoding($false)

foreach ($file in $targets) {
    $path = Join-Path $pub $file
    if (-not (Test-Path $path)) { Write-Warning "跳过不存在的文件：$file"; continue }
    $text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
    if ($text.Contains($placeholder)) {
        $text = $text.Replace($placeholder, $domain)
        [System.IO.File]::WriteAllText($path, $text, $utf8)
        Write-Host "  [ok] $file"
        $changed++
    }
    else {
        Write-Host "  [skip] $file 不含占位域名"
    }
}

Write-Host ""
Write-Host "完成：$changed 个文件已指向 $domain" -ForegroundColor Green
Write-Host "下一步： wrangler pages deploy public --project-name yunsheng" -ForegroundColor Cyan