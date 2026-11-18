# 第三方模型补丁 (Third-Party Model Patch)

把本机 Antigravity 的「第三方模型接入补丁」打包成了一个 Antigravity 插件：
补丁的全部资产（`dist/modelPatch/**` 运行时、锚点编辑定义、preload UI 注入）
都随插件走，Antigravity 每次更新替换 `app.asar` 后，都可以用插件内的工具
**重新应用**，并在 Customizations 页面里看到这个插件。

## 补丁是什么

Antigravity 的模型请求由 `resources/bin/language_server.exe` 发往 Google
Cloud Code 私有 API。本补丁在 Electron 主进程 (`app.asar`) 内插入一层本地代理：

```
language_server.exe
   ──(HTTP, baseURL 被改写)──> 127.0.0.1:50999 (modelPatch 代理)
                                  └─(HTTPS, Bearer)─> 真正的上游
                                        · Google Cloud Code（官方模型）
                                        · DeepSeek / StepFun 等 OpenAI 兼容 API（自定义模型）
```

**补丁的代码全部来自本插件目录，`app.asar` 里只留锚点编辑和两个转发入口。**

| 部分 | 位置 | 说明 |
| --- | --- | --- |
| 运行时 | 本插件 `assets/modelPatch/**`（43 个文件） | 本地代理、OpenAI/Anthropic/Google/Ollama 翻译器、`thoughtSignature` 回放、多账号故障转移、自定义模型管理与加密存储 |
| 依赖 | 宿主 `app.asar/node_modules/electron-log` | 由 asar 内转发入口把 `require("electron-log")` 指回宿主已加载的那一份；插件不再自带副本（第二份会抢 `_ELECTRON_LOG_` IPC 并让主进程崩溃） |
| 转发入口 | `dist/modelPatch/desktop.js`、`dist/modelPatch/proxy.js` | asar 内只有几十行的 generated forwarder，运行时从本插件目录 `require` 真实实现 |
| 主进程编辑 | `dist/main.js` | 安装 desktop 运行时（拦截 `GetAvailableModels` / `SetCloudCodeURL`） |
| 语言服务器编辑 | `dist/languageServer.js` | 启动本地代理，把 `--api_server_url` / `--cloud_code_endpoint` / `--inference_api_server_url` 指向代理 |
| preload 追加 | `dist/preload.js` | 追加自定义模型管理 UI（设置页里的「自定义模型」区） |

转发入口按以下顺序解析真实运行时，找不到会给出明确报错：

1. 环境变量 `ANTIGRAVITY_MODEL_PATCH_DIR`
2. `~/.gemini/config/plugins/third-party-model-patch/assets/modelPatch`

因此 `resources/` 下的 `.antigravity-model-patch`、`app.asar.patched` 之类的
文件与运行时无关，删掉不影响第三方模型接入；本插件也**不往
`resources/` 写任何东西**，唯一的写入是重建 `app.asar` 本身。

自定义模型配置在 `~/.gemini/antigravity/custom_models.json`（API key 以
`enc:` 机器绑定加密存储，建议通过设置界面的 UI 增删，不要手写 key）。

## 使用

```bat
scripts\activate-patch.bat          :: 菜单：应用 / 等待后应用 / 状态 / 校验
```

或直接用 Node（任意 Node 18+）：

```bash
node scripts/apply-model-patch.mjs --status     # 只读状态报告
node scripts/apply-model-patch.mjs --verify     # 校验完整性 + 补丁标记
node scripts/apply-model-patch.mjs --dry-run    # 预演
node scripts/apply-model-patch.mjs --apply      # 应用（需先关闭 Antigravity）
node scripts/apply-model-patch.mjs --apply --force   # 运行中也强制（不推荐）
node scripts/apply-model-patch.mjs --asar <path>      # 指定其它 app.asar
```

退出码：`0` 成功/已应用，`1` 错误，`2` Antigravity 正在运行，`3` 锚点或目标
文件找不到（版本漂移，需人工适配），`4` 校验失败。

## Antigravity 更新后怎么办

更新会整体替换 `app.asar`，补丁随之丢失（自定义模型从设置里消失）。
更新完成后：

1. 运行 `scripts\activate-patch.bat` 选 `1`（自动关闭 → 应用 → 重启）；或
2. 让 agent 调用 `model-patch-manager` 技能重新应用。

补丁应用是幂等的：已应用时再跑一次只会提示 `already applied`。
每次应用前会自动备份 `app.asar.model-patch-<version>.bak`（每个版本一份），
回退就是用备份覆盖 `app.asar`。

## 与「更新修复」守护的关系

本机另有一个常驻守护（`Antigravity Update Fix` 计划任务）修复更新器的
「无法关闭」竞态，它就地改写 `dist/ipcHandlers.js` / `dist/updater.js`
（字节数不变，不改头部哈希）。两者文件不重叠，顺序无关；本插件的 apply
会重建整个 asar 并刷新所有 integrity 哈希，恰好会把守护留下的过期哈希
一并修正。

## 资产

```
third-party-model-patch/
├── plugin.json                  # 插件清单（Customizations 页面可见）
├── README.md
├── assets/
│   ├── logo.svg
│   ├── patches.json             # 锚点编辑定义（main.js / languageServer.js / preload.js）
│   ├── preload-inject.js        # 追加到 preload.js 的 UI 注入 blob
│   └── modelPatch/**            # 43 个补丁运行时文件（真实实现，随插件走）
├── scripts/
│   ├── apply-model-patch.mjs    # 纯 Node 重打补丁器（无第三方依赖）
│   ├── rebuild-assets.mjs       # 维护：从 clean/patched asar 重新生成 assets
│   ├── test-forwarder.mjs       # 自检：forwarder 语法 + 真实 require 链路
│   ├── test-thinking.mjs        # 自检：思考能力识别 + 档位映射 + reasoning_effort
│   ├── add-effort-variants.mjs  # 按模型原生档位生成变体（DeepSeek low/high/max 等）
│   ├── activate-patch.ps1
│   └── activate-patch.bat
├── skills/model-patch-manager/SKILL.md
└── rules/AGENTS.md
```

自检（不启动 Antigravity，用桩 `electron` 走通 require 链）：

```bat
node scripts\test-forwarder.mjs
node scripts\test-thinking.mjs
```

## 思考强度（thinking level）

DeepSeek V4/Flash 与 StepFun Step 5 / 3.7 / 3.5 / router 都是推理模型，但它们的
模型 id 不含 `thinking`/`reasoning` 字样，早期版本的能力探测把它们判成
「不支持思考」，于是原生界面不显示思考档位选择器。现在：

- `proxy/modelUtils.js` 把这些家族识别为思考模型，目录向原生 IDE 声明
  `supportsThinking: true`（也可用模型配置里的 `supportsThinking` 显式覆盖）。
- **档位按模型原生划分**：DeepSeek 用 `low / high / max`（官方
  `reasoning_effort`），StepFun 用 `low / medium / high`。不同模型的选择器
  只有自己支持的档位。
- `proxy/requestOptions.js` 把档位翻译成请求参数：DeepSeek 额外发送
  `thinking: {type: enabled}` 并在思考模式下移除 `temperature` /
  `presence_penalty` / `frequency_penalty`；`none`（思考关闭）翻译为
  `thinking: {type: disabled}` 而不是非法的 `reasoning_effort`；`default`
  则不发送任何思考参数。
- `proxy/requestOptions.js` 的 `readNativeRequestEffort` 仍会读取本回合
  `generationConfig.thinkingConfig`，但它只用于**没有档位变体**的模型；
  档位变体自身的 `reasoningEffort` 优先，避免原生残留档位覆盖用户选择。
- 目录只广告**档位变体**、隐藏被复制的源条目（`proxy.js`）。原生选择器把
  无档位后缀的条目当作独立一行，源条目会和变体组重复；隐藏后每个模型只剩
  一行 + 档位子菜单。

调试：设 `AG_PATCH_TRACE=1` 启动 Antigravity，会在插件目录 `.trace.log` 记录
每回合收到的 `thinkingConfig`、解析出的档位，以及最终发给上游的
`reasoning_effort` / `thinking`。

### 档位变体（effort variants）与 Codex 滑条

Antigravity 原生选择器只识别 `low / medium / high / xhigh / max` 这五个档位
标记（`Name (effort)`），并按模型名分组。裸的 DeepSeek/StepFun 条目没有档位
标记，既会与变体重复显示，也会让滑条置灰锁定。因此必须生成档位变体：

- 关闭 Antigravity 后运行本插件脚本（等效于设置页的 **Effort variants**
  按钮，但按模型使用正确档位、可批量、幂等）：

```bat
node scripts\add-effort-variants.mjs            :: 校正所有支持思考的模型
node scripts\add-effort-variants.mjs deepseek-flash step-5-preview
node scripts\add-effort-variants.mjs --dry-run
node scripts\add-effort-variants.mjs --reset    :: 同时清理孤立的旧变体
```

- 脚本会按模型写入原生档位：DeepSeek 生成 `low/high/max`，StepFun 生成
  `low/medium/high`，其他 provider 默认 `low/medium/high`；并删除不匹配的旧
  变体（例如 DeepSeek 之前的 `medium` 副本）。
- 生成后重启 Antigravity。模型列表里每个模型只出现一次，右侧档位子菜单就是
  该模型的原生档位；Codex 滑条的分档点也从同一组变体读取，因此不同模型的
  滑条档位数/名称会随模型变化。
- 滑条对运行中的窗口可用滑条插件的 `inject-cdp.cjs` 热注入。

> 原生 UI 只支持上面五个档位标记，所以 DeepSeek 的 `none`（完全关闭思考）和
> `default`（不指定档位）不能作为原生档位显示。需要关闭思考时可把该模型条目
> 的 Reasoning effort 直接设为 `none`（设置页下拉框支持），代理会翻译成
> `thinking: {type: disabled}`。

## 验证记录（2026-11-18，2.32.2）

- `test-forwarder.mjs`：两个 forwarder 均解析到插件内真实实现，
  `desktop.js → install`，`proxy.js → setLanguageServerPortResolver,
  loadCustomModels, startProxy, stopProxy, getProxyPort`；
- 从干净备份重建的 asar 与厂商补丁版 **1111/1111 个文件逐字节一致**；
- 重建后 764 个打包条目 integrity 全部通过；3 个编辑文件 `node --check` 通过；
- 应用后代理在 `127.0.0.1:50999` 监听，3 个自定义模型（DeepSeek-V4.1-Flash /
  DeepSeek-V4-Pro / Step 5 Preview）在设置中可见。
- `test-thinking.mjs`：DeepSeek/StepFun 推理模型被识别为思考模型；原生档位
  映射正确；OpenAI 格式按模型下发 `reasoning_effort`（DeepSeek 额外处理
  `thinking` 开关与采样参数）；模型列表对每个模型只显示一行档位组。

## 许可与署名

Apache License 2.0（见 `LICENSE`）。`assets/modelPatch/` 运行时改编自
[vahapogut/antigravity-add-model](https://github.com/vahapogut/antigravity-add-model)
（Apache-2.0），详见 `NOTICE`。forwarder 打包、重打补丁工具与思考强度支持为
本项目的修改/新增。

> 免责声明：这是社区维护的非官方集成，与 Google 无关联、未获其背书。
> 补丁通过改写本机 `app.asar` 实现，Antigravity 官方更新可能使其失效，
> 用后请自行验证；请遵守所接入模型服务商的使用条款。
