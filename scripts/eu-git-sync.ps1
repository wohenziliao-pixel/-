#Requires -Version 5.1
<#
.SYNOPSIS
  在本机 SillyTavern 仓库根目录执行：初始化 Git（若尚无）、暂存全部改动、提交、可选推送。

.DESCRIPTION
  - 未安装 Git 时会报错并提示安装地址。
  - 远程地址：优先用参数 -Remote；否则读环境变量 EU_GIT_REMOTE；再否则读文件 scripts/eu-git-remote.url（首行非空 URL）。
  - 将 scripts/eu-git-remote.url.template 复制为 scripts/eu-git-remote.url 后改成你的仓库地址（该文件已在 .gitignore，不会进库）。

.EXAMPLE
  .\scripts\eu-git-sync.ps1 -Commit -Message "EU 更新"

.EXAMPLE
  .\scripts\eu-git-sync.ps1 -Commit -Push -Message "EU 上线"

.EXAMPLE
  .\scripts\eu-git-sync.ps1 -Init
#>
param(
  [switch]$Init,
  [switch]$Commit,
  [switch]$Push,
  [string]$Remote = "",
  [string]$Message = ("EU snapshot " + (Get-Date -Format "yyyy-MM-dd HH:mm"))
)

if (-not $Init -and -not $Commit -and -not $Push) {
  $Commit = $true
}

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

function Resolve-GitExe {
  try {
    $cmd = Get-Command git -ErrorAction Stop
    if ($cmd.Path -and (Test-Path $cmd.Path)) { return $cmd.Path }
  } catch {
    # ignore, try next path
  }
  $paths = @(
    "$env:ProgramFiles\Git\cmd\git.exe",
    "$env:ProgramFiles\Git\bin\git.exe",
    "${env:ProgramFiles(x86)}\Git\cmd\git.exe"
  )
  foreach ($p in $paths) {
    if ($p -and (Test-Path $p)) { return $p }
  }
  $w = (& where.exe git 2>$null | Select-Object -First 1)
  if ($w -and (Test-Path $w)) { return $w }
  return $null
}

function Ensure-GitIdentity {
  param([string]$Git)
  $name = & $Git config --get user.name 2>$null
  if (-not [string]::IsNullOrWhiteSpace($name)) { return }
  Write-Host "[eu-git-sync] 未配置 user.name/email，写入本机占位（仅用于提交 metadata，可自行 git config 修改）"
  & $Git config user.email "eu-local@invalid.local"
  & $Git config user.name "EU Local"
}

function Read-RemoteFromFile {
  $f = Join-Path $RepoRoot "scripts\eu-git-remote.url"
  if (-not (Test-Path $f)) { return "" }
  $line = (Get-Content -LiteralPath $f -Encoding UTF8 | Where-Object { $_.Trim() -and -not $_.Trim().StartsWith("#") } | Select-Object -First 1)
  if ($line) { return $line.Trim() }
  return ""
}

$git = Resolve-GitExe
if (-not $git) {
  Write-Error @"
未找到 Git 可执行文件。请先安装 Git for Windows 并重启终端后再运行本脚本：
https://git-scm.com/download/win
安装时勾选「Add Git to PATH」。
"@
}

if ($Init -or -not (Test-Path (Join-Path $RepoRoot ".git"))) {
  if (-not (Test-Path (Join-Path $RepoRoot ".git"))) {
    Write-Host "[eu-git-sync] git init -b main"
    & $git init -b main
  }
  Ensure-GitIdentity -Git $git
}

if (-not (Test-Path (Join-Path $RepoRoot ".git"))) {
  Write-Error "仍未找到 .git 目录，初始化失败。"
}

Ensure-GitIdentity -Git $git

if ($Commit -or $Push) {
  Write-Host "[eu-git-sync] git add -A"
  & $git add -A
  Write-Host "[eu-git-sync] git status -sb"
  & $git status -sb
  Write-Host "[eu-git-sync] git commit -m ..."
  & $git commit -m $Message
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "提交未完成（可能没有变更，或已在最新提交）。可忽略后继续 -Push。"
  }
}

if ($Push) {
  $url = $Remote.Trim()
  if (-not $url -and $env:EU_GIT_REMOTE) {
    $url = [string]$env:EU_GIT_REMOTE.Trim()
  }
  if (-not $url) { $url = Read-RemoteFromFile }
  if (-not $url) {
    Write-Error @"
未指定远程仓库。任选其一：
1) .\scripts\eu-git-sync.ps1 -Push -Remote https://github.com/你/仓库.git
2) 环境变量 EU_GIT_REMOTE
3) 复制 scripts\eu-git-remote.url.template 为 scripts\eu-git-remote.url，首行写仓库 HTTPS 或 SSH URL
"@
  }
  $remoteNames = @(& $git remote 2>$null)
  $hasOrigin = $remoteNames -contains 'origin'
  if ($hasOrigin) {
    Write-Host "[eu-git-sync] git remote set-url origin $url"
    & $git remote set-url origin $url
  } else {
    Write-Host "[eu-git-sync] git remote add origin $url"
    & $git remote add origin $url
  }
  Write-Host "[eu-git-sync] git push -u origin HEAD"
  & $git push -u origin HEAD
}

Write-Host "[eu-git-sync] 完成。仓库根目录: $RepoRoot"
