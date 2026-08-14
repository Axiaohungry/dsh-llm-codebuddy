# DSH CodeBuddy Provider

为 DeepSeek Harness（DSH）增加
`CodeBuddy 中国区` Provider。安装后可直接在 DSH WebUI 中填写 API Key、获取模型、
调整模型参数并使用 CodeBuddy 模型。

## 功能

- 在“设置 → 模型 → 添加提供方”中显示 `CodeBuddy 中国区`；
- WebUI 只需要填写 API Key，无需配置 API 地址和协议；
- 从 CodeBuddy `/v3/config` 获取当前 `cli` Agent 可用模型；
- 支持编辑模型 ID、显示名称、上下文窗口和最大输出 Token；
- 支持添加、删除模型以及重新同步模型目录；
- 支持 `minimal / low / medium / high / xhigh / max` 思考程度；
- 未选择思考程度时，使用 CodeBuddy 对应模型的默认值；
- API Key 输入新值后保存即可替换，留空保存会保留原值；
- 模型接口暂时不可用时，使用插件内置目录兜底；
- 插件独立安装，不修改 DSH 全局安装目录。

## 兼容性

- Windows、Linux、macOS；
- Node.js `>= 22.19.0`；
- 已验证 DSH `0.1.0-rc.6`；
- 当前版本使用 DSH `llm-pi-ai` 的设置界面，并保留该适配器原有 Provider。

> DSH 仍处于预发布阶段。如果未来版本调整插件接口，本插件可能需要同步升级，
> 但 DSH 普通更新不会覆盖插件源码。

## 安装

### 从 npm 安装

发布到 npm 后执行：

```powershell
dsh plugin --profile web add dsh-llm-codebuddy
dsh plugin --profile headless add dsh-llm-codebuddy
```

只使用 WebUI 时，第一条命令即可。

### 从 GitHub 安装

```powershell
dsh plugin --profile web add github:Axiaohungry/dsh-llm-codebuddy
dsh plugin --profile headless add github:Axiaohungry/dsh-llm-codebuddy
```

也可以安装指定版本：

```powershell
dsh plugin --profile web add github:Axiaohungry/dsh-llm-codebuddy#v1.2.0
```

### 从源码安装

```powershell
git clone https://github.com/Axiaohungry/dsh-llm-codebuddy.git
cd dsh-llm-codebuddy
.\install.ps1
```

安装或升级后请重启 DSH。

## WebUI 配置

1. 打开“设置 → 模型”。
2. 点击“添加提供方”。
3. 选择 `CodeBuddy 中国区`。
4. 输入 CodeBuddy API Key 并保存。
5. 点击该 Provider 的“编辑”，展开“自定义设置”。
6. 点击“获取可用模型”，选择模型并导入。
7. 按需修改模型参数，然后保存。

已保存的 Provider 再次进入“编辑”时，会直接显示之前保存的模型目录。

## 模型配置规则

- 没有自定义模型目录：使用 CodeBuddy 在线目录，失败时使用内置目录；
- 保存了自定义目录：只向 DSH 提供目录中保留的模型；
- 已知模型字段留空：继承 CodeBuddy 在线目录或内置目录中的值；
- 新模型缺少容量时：上下文窗口默认为 `262144`，最大输出默认为 `32768`；
- 点击“恢复默认模型”：删除自定义目录，恢复适配器目录。

上下文窗口和最大输出 Token 应根据 CodeBuddy 实际限制填写。配置值超过服务端限制时，
CodeBuddy 仍可能拒绝请求。

## 思考程度

DSH 负责显示思考程度选项，插件将选中的档位转换为
`reasoning_effort` 并发送给 CodeBuddy。模型推理由 CodeBuddy 云端执行。

支持档位：

```text
minimal / low / medium / high / xhigh / max
```

本插件不提供 `off`，因为当前 CodeBuddy 模型目录中的模型属于推理模型。

## 更新

npm 安装：

```powershell
dsh plugin --profile web add dsh-llm-codebuddy@latest
dsh plugin --profile headless add dsh-llm-codebuddy@latest
```

GitHub 安装：

```powershell
dsh plugin --profile web add github:Axiaohungry/dsh-llm-codebuddy#v1.2.0
dsh plugin --profile headless add github:Axiaohungry/dsh-llm-codebuddy#v1.2.0
```

## 卸载

```powershell
dsh plugin --profile web remove dsh-llm-codebuddy
dsh plugin --profile headless remove dsh-llm-codebuddy
```

卸载后重启 DSH。WebUI 中保存的 API Key 和模型配置不会由包管理器自动删除。

## 打包与发布

### 上传到 GitHub

先在 GitHub 创建一个空仓库 `dsh-llm-codebuddy`，然后在插件目录执行：

```powershell
git init
git add .
git commit -m "发布 dsh-llm-codebuddy v1.2.0"
git branch -M main
git remote add origin git@github.com:Axiaohungry/dsh-llm-codebuddy.git
git push -u origin main
git tag v1.2.0
git push origin v1.2.0
```

### 生成安装包

本地检查并生成 npm 安装包：

```powershell
npm ci --ignore-scripts
npm run check
npm pack
```

会生成类似 `dsh-llm-codebuddy-1.2.0.tgz` 的文件。可以直接测试：

```powershell
dsh plugin --profile web add .\dsh-llm-codebuddy-1.2.0.tgz
```

### 发布到 npm

首次发布：

```powershell
npm login
npm publish
```

建议在 GitHub 创建与 `package.json` 版本一致的 Release 和 Tag，例如 `v1.2.0`。

## 安全说明

- 不要把 API Key 写进仓库、README、Issue 或截图；
- API Key 由 DSH 凭据服务保存，插件不把密钥写入模型目录；
- npm 包只包含 `package.json` 中 `files` 指定的运行文件和文档；
- 发布前务必使用 `npm pack --dry-run` 检查包内容。

## 工作原理

```text
DSH Agent → 本插件 → CodeBuddy /v2/chat/completions
                    ↘ CodeBuddy /v3/config（获取模型）
```

- DSH：负责 Agent 循环、上下文、工具调用和权限；
- 插件：负责 Provider 注册、模型目录转换和请求兼容；
- CodeBuddy：负责模型推理并返回结果。

## License

[MIT](./LICENSE)
