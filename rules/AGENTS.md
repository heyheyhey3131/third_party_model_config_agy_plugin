# Third-Party Model Patch — 常驻规则

本机 Antigravity 装有第三方模型接入补丁（modelPatch），由 `third-party-model-patch`
插件管理：

- 补丁把模型请求经本地代理 `127.0.0.1:50999` 转发；自定义模型配置在
  `~/.gemini/antigravity/custom_models.json`（当前：DeepSeek-V4.1-Flash /
  DeepSeek-V4-Pro / Step 5 Preview）。
- **Antigravity 每次更新都会整体替换 `app.asar`，补丁随之失效。** 发现用户说
  「更新后自定义模型不见了 / 补丁没了」时，用 `model-patch-manager` 技能重新应用
  （先确认 Antigravity 已关闭）。
- 用户提到第三方模型、自定义模型、模型补丁、custom_models.json、DeepSeek、
  StepFun 接入或排障时，优先使用该技能，不要另起炉灶。
- 不要手动编辑 `app.asar` 或 `custom_models.json` 里的 `enc:` API key；
  改动分别走 `scripts/apply-model-patch.mjs` 和设置页 UI。
