# DSH CodeBuddy Provider

为 DeepSeek Harness（DSH）增加 `CodeBuddy 中国区` Provider。安装后可直接在
DSH WebUI 中填写 API Key、获取模型、调整模型参数并使用 CodeBuddy 模型。

> [!IMPORTANT]
> API Key 由 **WorkBuddy** 提供，本插件使用该 Key 调用供 CodeBuddy 使用的模型服务。
> DSH 中的 Provider 名称仍为 `CodeBuddy 中国区`。本项目是第三方适配器，并非
> WorkBuddy、CodeBuddy 或 DSH 官方插件。

## 功能

- WebUI 中直接添加 `CodeBuddy 中国区`；
- 只需填写从 WorkBuddy 获取的 API Key；
- 自动获取 CodeBuddy 当前可用模型；
- 支持编辑模型 ID、名称、上下文窗口和最大输出 Token；
- 支持添加、删除模型以及重新同步模型目录；
- 支持 `minimal / low / medium / high / xhigh / max` 思考程度；
- 输入新 API Key 可替换旧值，留空保存则保留原值；
- 模型接口暂时不可用时使用内置目录兜底；
- 独立安装，不修改 DSH 全局安装目录。

## 环境要求

- Windows、Linux 或 macOS；
- Node.js `>= 22.19.0`；
- 已安装 DSH；
- 已验证 DSH `0.1.0-rc.6`。

安装器已自带 DSH 所需的 `pnpm`，无需全局安装。

> DSH 仍处于预发布阶段。未来版本如果调整插件接口，本插件可能需要同步升级；
> DSH 普通更新不会覆盖本插件。

## 安装

推荐使用一键安装命令：

```powershell
npx --yes dsh-llm-codebuddy@latest install
```

该命令会为 DSH 的 `web` 和 `headless` Profile 安装插件。完成后重启 DSH。

也可以分别安装：

```powershell
dsh plugin --profile web add dsh-llm-codebuddy@latest
dsh plugin --profile headless add dsh-llm-codebuddy@latest
```

只使用 WebUI 时，仅执行第一条即可。

## WebUI 配置

1. 打开“设置 → 模型”。
2. 点击“添加提供方”。
3. 选择 `CodeBuddy 中国区`。
4. 输入从 WorkBuddy 获取的 API Key 并保存。
5. 点击该 Provider 的“编辑”，展开“自定义设置”。
6. 点击“获取可用模型”，选择需要的模型并导入。
7. 按需修改模型参数，然后保存。

再次编辑已配置的 Provider 时，会直接显示上次保存的模型目录。

## API Key 替换

- 输入新的 API Key 并保存：替换原 Key；
- API Key 输入框留空并保存：保留原 Key；
- 更换 Key 后建议重新点击“获取可用模型”，同步新账号的模型权限。

API Key 由 DSH 凭据服务保存，不会写入模型目录或插件源码。

## 模型配置

- 没有自定义目录：使用 CodeBuddy 在线目录，失败时使用内置目录；
- 保存自定义目录：仅向 DSH 提供目录中保留的模型；
- 已知模型字段留空：继承在线目录或内置目录中的值；
- 新模型缺少容量：上下文窗口默认 `262144`，最大输出默认 `32768`；
- 点击“恢复默认模型”：删除自定义目录并恢复适配器目录。

配置值超过服务端真实限制时，CodeBuddy 仍可能拒绝请求。

## 思考程度

DSH 显示思考程度选项，插件把选中的档位转换为 `reasoning_effort` 并发送给
CodeBuddy。模型推理由 CodeBuddy 云端执行。

```text
minimal / low / medium / high / xhigh / max
```

当前不提供 `off`，因为 CodeBuddy 模型目录中的模型属于推理模型。未选择档位时，
使用 CodeBuddy 对应模型的默认值。

## 更新

重新运行安装命令即可更新到最新版：

```powershell
npx --yes dsh-llm-codebuddy@latest install
```

更新完成后重启 DSH。模型配置和 API Key 不会被覆盖。

## 卸载

```powershell
npx --yes dsh-llm-codebuddy@latest uninstall
```

卸载命令会：

1. 备份 `~/.dsh/settings.yaml`；
2. 只删除 `llm-pi-ai.providers.codebuddy-cn` 配置；
3. 保留其他 Provider 和 DSH 设置；
4. 从 `web`、`headless` Profile 移除插件；
5. 保留 API Key 凭据，方便以后重新安装。

完成后重启 DSH。备份文件名类似：

```text
settings.yaml.codebuddy-backup-2026-08-14T12-00-00-000Z
```

源码仓库、本地安装包和 API Key 不会被删除。

## 常见问题

### 安装后看不到 CodeBuddy

确认已经重启 DSH，并检查 Web Profile：

```powershell
dsh plugin --profile web list --depth 0
```

### 获取模型失败

确认 API Key 来自 WorkBuddy 且仍然有效，然后重新输入 Key 并点击“获取可用模型”。
接口临时不可用时，插件仍会提供内置模型目录。

### 卸载后仍显示旧页面

关闭正在运行的 DSH，再重新启动。已经运行的进程不会自动卸载内存中的插件。

## 工作原理

```text
WorkBuddy 提供 API Key
          ↓
DSH Agent → 本插件 → CodeBuddy /v2/chat/completions
                    ↘ CodeBuddy /v3/config（获取模型）
```

- DSH：负责 Agent 循环、上下文、工具调用和权限；
- WorkBuddy：提供 API Key；
- 插件：负责 Provider 注册、模型目录转换和请求兼容；
- CodeBuddy：负责模型推理并返回结果。

## License

[MIT](./LICENSE)
