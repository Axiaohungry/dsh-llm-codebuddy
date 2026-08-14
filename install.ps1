$ErrorActionPreference = 'Stop'

Push-Location $PSScriptRoot
try {
    npm install --ignore-scripts --no-audit --no-fund
    dsh plugin --profile web add $PSScriptRoot
    dsh plugin --profile headless add $PSScriptRoot
}
finally {
    Pop-Location
}

Write-Host 'CodeBuddy Provider 已安装。请重启 DSH，然后在“设置 → 模型 → 添加提供方”中选择 CodeBuddy 中国区。'
