# 参与贡献

## 提改动之前

```powershell
node scripts/adapter-test.mjs    # 9 项协议测试，本地假上游，不需要 key
```

这个脚本必须在改动后仍然全绿。它覆盖 openai / ark / gemini 三个适配器的请求体字段、尺寸吸附、base64 解码、URL 下载、引用剥离。

装了 DSH 的话再跑一遍端到端（18 项，需要 DSH 在跑且已装本插件）：

```powershell
node scripts/selftest.mjs
```

## 流程

1. Fork 本仓库
2. 从 `main` 切一个分支：`git checkout -b fix/短描述`
3. 改完提交，信息用 `type: 一句话`，类型取 `feat` / `fix` / `ci` / `docs` / `refactor`
4. 推到你自己的 fork，向本仓库 `main` 开 Pull Request
5. CI 会跑 `test`，全绿之后由维护者合入

有写权限的合作者一样走 PR，`main` 不接受直接推送。

## 改动范围

| 目录 | 放什么 |
|---|---|
| `index.js` | Host 侧：HTTP 路由、后台 job、落盘、凭据解析、Agent 工具 |
| `client.js` | 浏览器侧：侧边栏图标、整页 UI、composer、灯箱 |
| `lib/generate.js` | 协议适配、尺寸换算、三态结果归一、图片头解码 |
| `lib/capabilities.js` | 模型能力表与请求过滤 |
| `locale/` | 插件列表与设置页读的标题、描述 |
| `docs/` | 厂商 API 规格、插件结构底稿 |

## 几条硬规矩

- `index.js` 与 `client.js` 不引入第三方依赖，保持零安装即可运行
- 浏览器侧只用 `react`（由宿主模块表提供），不引 UI 库
- 颜色一律走 `--dsw-alias-*` 主题变量，保证明暗两套主题都能看
- 新增协议适配器时，同时补一条 `scripts/adapter-test.mjs` 用例
- 新增模型家族时，在 `lib/capabilities.js` 里给出 `resolutions` / `aspects` / `seed` / `negativePrompt` / `edit` 的判定，并说明依据

## 本地装载

```powershell
# 在 DSH 里发一句
安装这个 bundle：<你 clone 的目录>
```

改完 Host 侧 `.js` 要重启一次 DSH 才生效（Node 模块缓存），浏览器侧刷新页面即可。

```powershell
Stop-Process -Id (Get-NetTCPConnection -LocalPort 3080 -State Listen).OwningProcess -Force
```
