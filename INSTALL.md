# 安装说明

这是 DSH（DeepSeek Harness）的一个 bundle 插件，装进 profile 后侧边栏会多出一格「生图工坊」。

## 前置

- 已经能跑起来的 DSH，Web GUI 在 `http://127.0.0.1:3080`
- 一个能用的生图模型（OpenAI 兼容中转、火山方舟、通义万相、Google Gemini 任一）

## 一、把包放到合适的位置

解压到任意固定目录，路径里**不要带空格**最省事：

```
D:\plugins\linkSub-image-studio\
├─ package.json
├─ cordis.patch.yml
├─ index.js
├─ client.js
├─ lib\
├─ locale\
├─ icon.svg
├─ README.md
├─ INSTALL.md
└─ scripts\
```

## 二、安装进 profile

### 做法 A：让 DSH 里的 agent 装（省事）

在 DSH 对话框里发一句：

```
安装这个 bundle：D:\plugins\linkSub-image-studio
```

agent 会调用 `plugin_manager` 的 `install_bundle`，返回 `application: applied` 即装好。

### 做法 B：手动装

```powershell
cd $env:DSH_PROFILE_DIR
pnpm add "file:D:\plugins\linkSub-image-studio"
```

然后编辑同目录下的 `cordis.patch.yml`，追加：

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

`outputDir` 是图片落盘位置，相对 DSH 进程的工作目录。

## 三、重启 DSH

Host 侧的 JavaScript 要重新加载：

```powershell
Stop-Process -Id (Get-NetTCPConnection -LocalPort 3080 -State Listen).OwningProcess -Force
cd <你的 DSH 源码目录>
node --import tsx/esm apps/cli/src/bin.ts web --no-open
```

如果您平时用的是别的启动方式，照那个来。起来后刷新页面。

## 四、配置生图模型

打开 GUI → 设置 → 模型 → 添加提供商，选 OpenAI 兼容那一类，填三样：

| 字段 | 例子 |
|---|---|
| 名称 | `linksub-image` |
| baseURL | `https://linksub.fun/v1` |
| API Key | 您的 key |
| 模型 id | `Nano-banana-Pro`、`gpt-image-2.5-1.5K`、`doubao-seedream-4-0-250828` 等，一行一个 |

保存后回到侧边栏第 7 格「生图工坊」，模型下拉里就有它了。

## 五、用起来

- 框里写提示词，`Enter` 生成，`Shift+Enter` 换行
- 截图直接 `Ctrl+V` 粘进框里，就当作参考图；也可以把图片文件拖进去
- 想改上一张：开着「接上一张」直接说改哪儿，或点结果卡上的「继续修改」把原词带回来
- 比例、分辨率、协议、种子、质量都在工具条与「更多参数」里
- 会话在右上角：新建 / 切换 / 删除（删除只从列表移除，图片文件留在磁盘）

## 六、确认装好了

```powershell
curl.exe -s http://127.0.0.1:3080/api/image-gen/catalog
```

返回里能看到 `"ok":true` 与您的 provider 就对了。

完整的端到端自检（18 项）：

```powershell
cd D:\plugins\linkSub-image-studio
node scripts/selftest.mjs
```

协议适配器的离线测试（9 项，不需要 key）：

```powershell
node scripts/adapter-test.mjs
```

## 七、排错

| 现象 | 处理 |
|---|---|
| 侧边栏没有这一格 | 看 `cordis.patch.yml` 里那行 `id: image-studio` 在不在；重启一次 DSH |
| 页面提示 `cannot get property "llm" without inject` | Host 跑的是旧模块，重启 DSH |
| 模型来源显示「缺密钥」 | 设置 → 模型里该 provider 的 API Key 没存进去 |
| `HTTP 401` | key 与 baseURL 不是同一家 |
| `HTTP 502 openai_error` | 中转侧渠道不可用，去中转后台看分组余额与渠道状态 |
| `HTTP 400 invalid size` | 换更小的分辨率档，或换模型 |
| 生成后磁盘找不到图 | 看 `cordis.patch.yml` 里的 `outputDir`，默认是 DSH 进程工作目录下的 `outputs/images/` |
| 图片地址 404 | 文件名要从 `/api/image-gen/history` 里取，别自己拼 |

## 八、卸载

```powershell
cd $env:DSH_PROFILE_DIR
pnpm remove "@local/dsh-plugin-image-studio"
```

再从 `cordis.patch.yml` 删掉那行 `image-studio`，重启 DSH。已经生成的图片在 `outputs/images/` 下，自己删目录即可。
