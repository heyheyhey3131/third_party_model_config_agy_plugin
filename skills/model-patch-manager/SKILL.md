---
name: model-patch-manager
description: 管理 Antigravity 第三方模型补丁（modelPatch）：检查补丁状态、在 Antigravity 更新后重新应用补丁、校验 app.asar 完整性、备份与回退、排查自定义模型（DeepSeek / StepFun / OpenAI 兼容 provider）接入问题。当用户提到第三方模型、自定义模型、custom_models.json、模型补丁、model patch、补丁失效、更新后模型消失，或需要接入/排查 DeepSeek、StepFun 等自定义模型时使用本技能。
---

# Model Patch Manager

管理本机 Antigravity 的第三方模型接入补丁。补丁把 Antigravity 的模型请求
经一层本地代理（`127.0.0.1:50999`）转发，使 `language_server.exe` 既能走
官方 Google Cloud Code，也能走 DeepSeek / StepFun 等 OpenAI 兼容 API
（自定义模型，配置在 `~/.gemini/antigravity/custom_models.json`）。

## 0. 插件根目录

本技能位于 `<plugin>/skills/model-patch-manager/SKILL.md`，`<plugin>` 即
插件根目录，通常为：

```
~/.gemini/config/plugins/third-party-model-patch
```

（Windows 即 `%USERPROFILE%\.gemini\config\plugins\third-party-model-patch`。）
所有命令都在 `<plugin>` 下执行；Node 用系统 PATH 上的 `node`（18+）。

## 1. 补丁构成（forwarder 模式，重建自当前 app.asar，与版本解耦）

真实运行时**全部在插件目录**，`app.asar` 里只留锚点编辑和两个转发入口：

| 部分 | asar 内路径 | 插件资产 |
| --- | --- | --- |
| 运行时（45 文件） | 不进 asar，运行时从插件加载 | `assets/modelPatch/**` |
| 转发入口 | `dist/modelPatch/desktop.js`、`dist/modelPatch/proxy.js` | 由 apply 生成的 forwarder |
| 主进程编辑 | `dist/main.js` 插入 desktop 安装 | `assets/patches.json` |
| LS 编辑 | `dist/languageServer.js` 启动代理 + 改写端点 flag | `assets/patches.json` |
| preload 追加 | `dist/preload.js` 末尾追加 UI blob | `assets/preload-inject.js` |

`electron-log` 不自带副本，转发入口把解析指回宿主 `app.asar/node_modules`
（第二份会抢 `_ELECTRON_LOG_` IPC 导致主进程崩溃）。

代理端口默认 50999；若安装目录存在 `antigravity-proxy.json` 则以其
`requiredPort` 为准。

## 2. 状态检查（只读，随时可跑）

```bash
node scripts/apply-model-patch.mjs --status
```

报告：app.asar 路径与版本、payload 是否在位、3 个目标文件的补丁标记与
锚点匹配情况、代理端口与监听状态、自定义模型清单、备份列表、
Antigravity 进程状态。

```bash
node scripts/apply-model-patch.mjs --verify
```

校验所有打包条目 integrity + 补丁标记齐全。注意：`ipcHandlers.js` /
`updater.js` 可能显示 `STALE HASH`——那是「更新修复」守护就地改写留下的
过期哈希，运行时可忽略，下次 model-patch apply 会刷新。

## 3. 应用 / 重新应用补丁

**Antigravity 正在运行时会拒绝应用（退出码 2）。** 两种方式：

```bash
# 方式 A：菜单（自动关闭 → 应用 → 重启）
scripts\activate-patch.bat

# 方式 B：先让用户关闭 Antigravity，再
node scripts/apply-model-patch.mjs --apply
```

`--apply` 流程：读取当前 `app.asar` → 若已应用（forwarder 为最新、标记齐全、
asar 内无残留 payload）则幂等退出 → 计算改动（3 文件编辑 + 2 个 forwarder，
并移除旧 schema 遗留在 asar 内的 payload）→ 备份
`app.asar.model-patch-<version>.bak` → 重建 asar（未改动文件保留原始字节并
重算 integrity）→ 原子替换 → 写后自校验。预演用 `--dry-run`。

只改 `assets/modelPatch/**`（运行时）不需要重建 asar：forwarder 在运行时从
插件目录加载，重启 Antigravity 即生效。改了 forwarder 模板或锚点才需 `--apply`。

## 4. Antigravity 更新后的标准流程

1. 等更新安装完成（Antigravity 已退出、安装器 `Antigravity-x64.exe` 已结束）。
2. 跑 `--status` 确认补丁丢失（payload MISSING / NOT patched）。
3. 跑 `--apply`（应用前 app 必须关闭；更新后它本来就是关的）。
4. 启动 Antigravity，设置里应重新出现自定义模型。

若第 3 步退出码为 3（锚点漂移）：新版本改了编译产物结构。读取报错中指出的
目标文件，找到对应插入点，更新 `assets/patches.json` 里该文件的
`anchor`（保持 `op`/`text` 不变），必要时从旧版 asar 备份里对照，然后重跑
`--apply`。payload（`assets/modelPatch/**`）与版本无关，通常无需改动。

## 5. 回退

```bash
# 用备份覆盖（Antigravity 需先关闭）
copy "…\resources\app.asar.model-patch-<version>.bak" "…\resources\app.asar"
```

备份只对同一版本有效；跨版本不要混用。

## 6. 自定义模型管理

- 配置文件：`~/.gemini/antigravity/custom_models.json`。
- **增删模型优先引导用户在 Antigravity 设置页的「自定义模型」UI 操作**；
  agent 可以读取该 JSON 了解现状（`--status` 已汇总），但**不要手写
  `apiKey`**——它是 `enc:` 前缀的机器绑定加密值，只能由应用生成。
- 需要程序化新增时，可复制现有同 provider 条目的结构，把 `apiKey` 留空或
  让用户在 UI 里补录；`displayName` / `externalModelName` / `contextWindow` /
  `maxOutputTokens` / `supportsVision` 可按需改。
- 排障：代理日志看 Electron main.log 的 `[Model Patch]` / `[Proxy]` 行；
  诊断接口在插件 `assets/modelPatch/diagnostics.js`（进程内、不落盘）。
- 思考档位：DeepSeek V4/Flash、StepFun Step 5/3.7/3.5/router 已被识别为思考
  模型（`supportsThinking`）。档位按模型原生划分：DeepSeek
  `default/none/low/high/max`，StepFun `default/low/medium/high`，可用模型配置
  的 `reasoningLevels` 覆盖。代理翻译成 `reasoning_effort`（DeepSeek 另加
  `thinking` 开关，`none` 关闭思考，`default` 不发送参数）。设
  `AG_PATCH_TRACE=1` 启动可在插件 `.trace.log` 看到每回合命中的滑条覆盖值与
  最终发给上游的参数。自检：`node scripts/test-thinking.mjs`。
- **模型列表里同一模型出现两遍**：旧版本会为每个档位复制一份模型条目。代理
  现在过滤掉所有 `copyFrom` 副本，每个模型只显示一行；配置里残留的旧副本可用
  `node scripts/cleanup-effort-variants.mjs`（关闭 Antigravity，先备份）清掉。
- **滑条不显示档位 / 置灰**：档位不再来自「模型名(档位)」变体，而是滑条从
  `GET http://127.0.0.1:50999/plugin/effort/levels` 读取；返回空或 403 时先确认
  第三方模型补丁的代理在 50999 运行、且模型已启用。滑条拖动时 POST 到
  `/plugin/effort`，代理按会话写入 `~/.gemini/antigravity/effort_overrides.json`
  并在该会话的请求中生效，不切换模型。原生下拉只有一行是预期行为——原生 UI
  只认五个档位 token，`none/minimal/default` 只能由滑条表达。

## 7. 注意事项

- 应用补丁时 Antigravity 必须关闭（`language_server.exe` 也要退出）。
- **版本更新后功能消失是预期现象**：官方更新整体替换 `app.asar`，清掉_archive 内
  钩子；运行时在插件目录不受影响。`scripts/patch-guardian.cjs` 常驻守护会在更新后
  应用关闭的空窗自动重打两个补丁（`--install-task` 注册 HKCU Run 开机自启，无需
  管理员），用户无需手动操作。仅当大版本改动锚点致 `--apply` 失配时才需人工更新
  `assets/patches.json`。手动恢复：关闭应用后 `--apply` + 滑条 `patch-asar.cjs`。
- 端口 50999 被占用时代理起不来，Antigravity 会报错；关闭占用进程即可。
- 本插件不往 `resources/` 写运行时文件，唯一写入是重建 `app.asar`；备份
  `app.asar.model-patch-<version>.bak` 放在 `resources/` 根下（不深埋子目录，
  避免超长路径导致 NSIS 卸载失败）。旧版遗留的 `.antigravity-model-patch\`
  与运行时无关，可安全删除。
- 守护进程只在 Antigravity 关闭时写盘并做防抖，不会与运行中的实例或官方更新器
  抢文件；日志在 `scripts/patch-guardian.log`。
