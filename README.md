# 生图工坊

> DSH（DeepSeek Harness）的侧边栏生图工作台：文生图与图生图，模型直接取自你自己在「设置 → 模型」里加的 provider。

一个 bundle 插件。装进 profile，Web GUI 侧边栏就多出一格「生图工坊」，点开占满主栏，像对话一样出图、改图、翻历史。

- 支持 **4 类协议**：OpenAI Images（含 Azure 与各种 OpenAI 形状的中转）、Google Gemini、火山方舟 Seedream、通义万相
- **模型能力表**：按模型名识别家族与档位，不支持的参数直接不给你选，Host 端再剥一遍
- **多轮修改**：开着「接上一张」直接说要改哪儿，或点结果卡上的「继续修改」把原词带回来
- **后台任务**：生成提交即返回，切页、刷新、关标签页都不影响，回来结果还在
- **多会话**：新建 / 切换 / 删除，互不串味
- **粘贴即上传**：截图 `Ctrl+V` 直接当参考图，也能拖文件进来
- **失败可救**：上游出图了但没下下来时，直链会留在任务上，结果卡片给一个「手动重下」，只重拉图片、不重新生成
- 图片落盘、历史持久化、真实像素回读，进程重启不丢已出的图

## 截图

> 界面截图待补：把运行中的截图存为 `docs/screenshot.png`，再把下面这行取消注释即可显示。
>
> `![生图工坊界面](docs/screenshot.png)`

## 安装

```powershell
# 1. 解压到任意固定目录
#    例如 D:\plugins\linkSub-image-studio

# 2. 装进 DSH profile —— 在 DSH 里发一句：
#    安装这个 bundle：D:\plugins\linkSub-image-studio
```

也可以手动装：

```powershell
cd $env:DSH_PROFILE_DIR
pnpm add "file:D:\plugins\linkSub-image-studio"
```

再往同目录的 `cordis.patch.yml` 追加：

```yaml
- insert:
    - id: image-studio
      name: '@local/dsh-plugin-image-studio'
      config:
        outputDir: outputs/images
        timeoutMs: 180000
        maxRetries: 3
        historyLimit: 200
```

改完重启 DSH，刷新页面。逐条步骤与排错见 [INSTALL.md](INSTALL.md)。

## 配置模型

打开 GUI → 设置 → 模型 → 添加提供商（OpenAI 兼容那一类），填 `名称` / `baseURL` / `API Key` / `模型 id`。保存后生图工坊的模型下拉里立刻就有它——插件不存密钥，只从 Host 内存里读一次用于发请求。

## 支持的协议

| 协议 | 端点 | 结果形态 | 图生图 |
|---|---|---|---|
| `openai` | `{baseURL}/images/generations`，改图 `/images/edits` | `data[].b64_json` 或 `data[].url` | 支持，最多 4 张 |
| `openai-compat` | 同上，覆盖 OpenAI 形状的中转与网关 | 同上 | 支持 |
| `gemini` | `{baseURL}/models/{model}:generateContent` | `candidates[].content.parts[].inlineData` | 支持，`inline_data` |
| `ark` | `{baseURL}/images/generations` | `data[].url` | 支持，`image[]` |
| `dashscope` | `{baseURL}/images/generations` | `data[].url` | 走文生图 |

`auto` 按 provider id 与 baseURL 里的关键词推断；Azure 由 `openai.azure.com` 认出，自动换 `api-key` 头与 `?api-version=`。二十家厂商的完整请求体、响应体、异步轮询流程在 [docs/providers.md](docs/providers.md)。

## 模型能力表

`lib/capabilities.js` 读模型 id 判断家族（`gpt-image` / `nano-banana` / `grok-image` / `seedream` / `wanx` / `flux` / `sd`）与名字里已写着的档位（`-4K`、`-1.5K`），据此决定：

| 决定什么 | 例子 |
|---|---|
| 分辨率档 | `Grok-image-2.0-4K` 锁死 4K，其余档位不给 |
| 比例集 | `gpt-image` 只给 `1:1 / 3:2 / 2:3`，选 `16:9` 自动吸附到 `3:2` |
| 种子 | `gpt-image`、`nano-banana`、`grok-image` 不吃，输入框直接禁用 |
| 负面词 | 只有 `wanx`、`flux`、`sd` 吃 |
| 参考图 | `grok-image`、基础 `flux` 不吃，Host 端把 `references` 清空 |
| 质量 / 格式 | 只有 `gpt-image` 一族有这两个下拉 |

## 界面

顶部是标题栏与会话切换（新建 / 删除 / 刷新），中间是结果流，底部是对话框：

- 提示词写在框里，`Enter` 生成、`Shift+Enter` 换行、`Ctrl/Cmd+Enter` 也生成
- 中文输入法选词时的回车不会误触发生成
- 工具条一行：模型下拉、比例下拉、分辨率、更多参数、接上一张、只发新词、圆形发送按钮
- 点结果图进全屏灯箱，`Esc` 关、方向键翻页
- 比例下拉里每项带用途：`16:9  宽屏 · 视频封面`

## Host 接口

```
GET  /api/image-gen/catalog             provider、模型、协议、比例、分辨率、密钥状态
POST /api/image-gen/generate            提交生成，202 返回 job id
GET  /api/image-gen/job?id=...          查 job 状态与结果
GET  /api/image-gen/jobs                最近 20 个 job
GET  /api/image-gen/file?name=...       读图，限 outputDir 内、限 png/jpg/webp
GET  /api/image-gen/history?thread=...  某会话的历史记录
GET  /api/image-gen/threads             会话列表
POST /api/image-gen/thread/delete       归档一个会话（图片文件保留）
POST /api/image-gen/probe               探测模型披露的元数据与实际出图尺寸
```

同时注册了 Agent 工具 `image_generate`，对话里也能直接出图。

## 配置项

| 键 | 默认 | 说明 |
|---|---|---|
| `outputDir` | `outputs/images` | 图片按 `yyyyMMdd/` 分目录，旁边一份同名 `.json` 元数据 |
| `timeoutMs` | `180000` | 单次 HTTP 超时 |
| `maxRetries` | `3` | 429 与 5xx 的退避重试次数 |
| `historyLimit` | `200` | 每个会话保留的历史条数 |

## 自测

```powershell
# 18 项端到端（需要 DSH 在跑，且已装好本插件）
node scripts/selftest.mjs

# 9 项协议适配器测试（本地假上游，不需要 key）
node scripts/adapter-test.mjs
```

## 目录

```
├─ index.js              Host 插件：路由、job、落盘、凭据解析、Agent 工具
├─ client.js             浏览器半：侧边栏图标 + 主面板页面
├─ lib/
│  ├─ generate.js        协议适配、尺寸换算、真实像素解码
│  └─ capabilities.js    模型能力表、请求过滤
├─ locale/               插件列表与设置页读的标题、描述
├─ docs/
│  ├─ providers.md       二十家厂商 API 规格
│  └─ plugin-blueprint.md 插件结构、模块划分、骨架代码
├─ scripts/              自测脚本
├─ cordis.patch.yml      Loader 插入行
└─ icon.svg
```

## 改动后如何生效

Host 侧的 `.js` 由 Node 模块缓存持有，改完要重启一次 `dsh web`：

```powershell
Stop-Process -Id (Get-NetTCPConnection -LocalPort 3080 -State Listen).OwningProcess -Force
```

浏览器侧改动随页面刷新加载。

## 排错

| 现象 | 处理 |
|---|---|
| 页面提示 `cannot get property "llm" without inject` | 跑的是旧模块，重启 DSH |
| provider 显示「缺密钥」 | 设置 → 模型里该 provider 的 key 没存进去 |
| `HTTP 400 invalid size` | 换更小的分辨率档，或换模型 |
| `HTTP 401` | key 与 baseURL 不是同一家 |
| `HTTP 502 openai_error` | 中转侧渠道不可用，去后台看分组余额与渠道状态 |
| 结果为空、响应里没有 `data` | 看原始响应体，或比照 [docs/providers.md](docs/providers.md) 里该家的字段 |

## 许可

[MIT](LICENSE)
