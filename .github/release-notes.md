## 安装

1. 下载下方 `linkSub-image-studio-*.zip` 并解压到固定目录
2. 在 DSH 里发一句：`安装这个 bundle：<解压目录>`
3. 重启 DSH，刷新页面，侧边栏第 7 格就是「生图工坊」
4. 设置 → 模型 里配一个生图 provider，回来就能画

完整步骤见仓库里的 `INSTALL.md`。

## 功能

- 侧边栏「生图工坊」：文生图、图生图、多轮修改
- 四类协议：OpenAI Images（含 Azure 与各种 OpenAI 形状中转）、Google Gemini、火山方舟 Seedream、通义万相
- 模型取自 DSH「设置 → 模型」里已配置的 provider，插件本身不存密钥
- 模型能力表：按家族与档位约束参数，Host 端再过滤一遍
- 后台 job + 轮询：切页、刷新、关标签页都不中断
- 多会话：新建 / 切换 / 删除
- 粘贴即上传、全屏灯箱、失败回填、真实像素回读

## 测试

发布前自动执行 `scripts/adapter-test.mjs`，9 项协议适配器测试，本地假上游，不需要 key。
