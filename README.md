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
| 运行时 | 本插件 `assets/modelPatch/**`（45 个文件） | 本地代理、OpenAI/Anthropic/Google/Ollama 翻译器、`thoughtSignature` 回放、多账号故障转移、自定义模型管理与加密存储 |
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
│   └── modelPatch/**            # 45 个补丁运行时文件（真实实现，随插件走）
├── scripts/
│   ├── apply-model-patch.mjs    # 纯 Node 重打补丁器（无第三方依赖）
│   ├── rebuild-assets.mjs       # 维护：从 clean/patched asar 重新生成 assets
│   ├── test-forwarder.mjs       # 自检：forwarder 语法 + 真实 require 链路
│   ├── test-thinking.mjs        # 自检：思考能力识别 + 档位映射 + reasoning_effort
│   ├── cleanup-effort-variants.mjs # 清理旧版按档位复制的重复模型条目
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
- **档位按模型原生划分**：DeepSeek 用 `default / none / low / high / max`，
  StepFun 用 `default / low / medium / high`，其他 OpenAI 兼容推理模型默认
  `default / low / medium / high`。其中 `default` 表示「不发送任何思考参数」，
  `none` 表示关闭思考。具体集合可用模型配置的 `reasoningLevels` 数组覆盖。
- `proxy/requestOptions.js` 把档位翻译成请求参数：DeepSeek 额外发送
  `thinking: {type: enabled}` 并在思考模式下移除 `temperature` /
  `presence_penalty` / `frequency_penalty`；`none` 翻译为
  `thinking: {type: disabled}` 而不是非法的 `reasoning_effort`；`default`
  则不发送任何思考参数。
- 覆盖优先级：**滑条按会话写入的档位 > 本回合原生 `thinkingConfig` >
  模型保存的 `reasoningEffort`**。没有滑条覆盖时才读取
  `generationConfig.thinkingConfig`（`readNativeRequestEffort`）。
- 目录对每个模型**只广告一行**（`proxy.js` 过滤掉所有带 `copyFrom` 的条目）。
  原生选择器只认 `low/medium/high/xhigh/max` 五种标签，`none`/`minimal`/
  `default` 无法做成档位子菜单，做成副本只会变成重复的独立行，因此档位完全
  交给滑条。

### 档位接口与 Codex 滑条

调度器（滑条）通过两个 loopback 接口读取/写入档位，代理按会话把档位合并进
发往上游的请求：

| 方法与路径 | 作用 |
| --- | --- |
| `GET /plugin/effort/levels?conversationId=…` | 返回每个模型的 `levels`、`current` |
| `POST /plugin/effort` | `{"model","level","conversationId"}`，校验档位属于该模型后落盘 |

- 档位按会话保存在 `~/.gemini/antigravity/effort_overrides.json`（只含模型名与
  档位 token，无密钥），同时记录「该模型最后一次选择」作为会话 id 对不上时的
  兜底。
- 接口只接受 loopback 调用方；来源页（`https://127.0.0.1:<LS 端口>`）由
  `loopbackSecurity.js` 的白名单放行，并回显 CORS 头供滑条页面使用。
- 滑条插件读取 `/plugin/effort/levels` 后按模型渲染分档点，拖动/按键时 POST
  新档位；不再切换模型，也不再需要档位副本。
- 旧版本生成过 `Name (low)` 之类的副本，升级后运行一次
  `node scripts\cleanup-effort-variants.mjs`（关闭 Antigravity）即可清掉；
  残留副本虽不会出现在列表中，但保留在配置里没有意义。

调试：设 `AG_PATCH_TRACE=1` 启动 Antigravity，会在插件目录 `.trace.log` 记录
每回合命中的滑条覆盖值，以及最终发给上游的 `reasoning_effort` / `thinking`。

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
  `thinking` 开关与采样参数）；每个模型的档位集合、`default/none` 语义、
  `reasoningLevels` 校验、会话级覆盖持久化均通过。

## 许可与署名

Apache License 2.0（见 `LICENSE`）。`assets/modelPatch/` 运行时改编自
[vahapogut/antigravity-add-model](https://github.com/vahapogut/antigravity-add-model)
（Apache-2.0），详见 `NOTICE`。forwarder 打包、重打补丁工具与思考强度支持为
本项目的修改/新增。

> 免责声明：这是社区维护的非官方集成，与 Google 无关联、未获其背书。
> 补丁通过改写本机 `app.asar` 实现，Antigravity 官方更新可能使其失效，
> 用后请自行验证；请遵守所接入模型服务商的使用条款。
