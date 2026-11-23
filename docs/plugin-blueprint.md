# 生图插件：需要交付的东西

## 一、插件要装进 DSH 时，文件清单只有这 6 件

```
D:\Code\生图插件\
├─ package.json          # 声明 dsh.bundle.patch，挂导出
├─ cordis.patch.yml      # 往 Loader 里插一行
├─ index.js              # Host 侧：注册 Tools、读配置、调 API
├─ providers/            # 各厂商适配器，一个文件一家
│   ├─ index.js
│   ├─ openai.js
│   ├─ gemini.js
│   ├─ ark.js
│   ├─ dashscope.js
│   ├─ fal.js
│   ├─ stability.js
│   └─ _http.js          # 统一 fetch + 重试 + 超时
├─ locale/zh.json        # meta.title / meta.description（设置页和插件列表要读）
├─ locale/en.json
└─ icon.svg              # ≤256 KiB，SVG/PNG/JPEG/WebP，必须在包内
```

`package.json`：

```json
{
  "name": "@local/dsh-plugin-image-gen",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["index.js", "providers/*.js", "cordis.patch.yml", "locale/*.json", "icon.svg"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

`cordis.patch.yml`：

```yaml
- insert:
    - id: image-gen
      name: '@local/dsh-plugin-image-gen'
      config:
        defaultProvider: openai
        outputDir: outputs/images
        providers:
          openai:
            apiKey: '${env:OPENAI_API_KEY}'
            model: gpt-image-1
          ark:
            apiKey: '${env:ARK_API_KEY}'
            model: doubao-seedream-4-0-250828
```

装法：`plugin_manager` 的 `install_bundle`，`target` 指向 `D:\Code\生图插件` 这个绝对目录。

## 二、代码要有的 12 个模块（少一个后期必返工）

| # | 模块 | 干什么 | 不做会怎样 |
|---|---|---|---|
| 1 | Provider 注册表 | `id → {kind, models, generate, edit}` | 每加一家改一次主流程 |
| 2 | 三态结果归一 | b64 / url / task 统一成 `Uint8Array` | 一半厂商接不进来 |
| 3 | 尺寸映射 | 比例名 → 各家像素/枚举 | 每家的 size 写法互相打架 |
| 4 | 异步轮询器 | task_id 轮询 + 指数退避 + 超时 | 万相/混元/BFL/MJ 全用不了 |
| 5 | 统一 fetch | 超时、429 退避、5xx 重试、AbortSignal 贯通 | 一次网络抖就整条链挂 |
| 6 | 错误归一 | `{code, message, provider, raw}` | 调用方拿到一堆异构报错 |
| 7 | 落盘与命名 | `outputs/images/<yyyyMMdd>/<hash>.png` + sidecar `.json` | 结果 URL 过期后图没了 |
| 8 | 缓存 | key = sha256(provider+model+prompt+params+seed) | 同 prompt 重复烧钱 |
| 9 | Key 管理 | 多 key 轮询、环境变量读取、日志脱敏 | key 写进日志、单 key 打满 429 |
| 10 | 并发闸门 | 每家一个信号量 | 批量跑直接撞限流 |
| 11 | 拦截识别 | `finish_reason` / `has_nsfw_concepts` / `base_resp` | 静默返回空图 |
| 12 | Mock 服务 | 本地假响应，跑通三态 | 没 key 时全链路验不了 |

## 三、统一内部接口（适配层只认这套）

```ts
export type ProviderKind = 'sync-b64' | 'sync-url' | 'task'

export interface GenRequest {
  prompt: string
  negativePrompt?: string
  aspect?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '21:9'
  width?: number
  height?: number
  n?: number
  seed?: number
  refImages?: string[]        // 本地路径或 data: URL
  extra?: Record<string, unknown>
}

export interface GenImage {
  bytes: Uint8Array
  mime: string
  path?: string               // 落盘后的绝对路径
  revisedPrompt?: string
}

export interface GenResult {
  provider: string
  model: string
  kind: ProviderKind
  images: GenImage[]
  seed?: number
  blocked?: { code: string; message: string }
  usage?: Record<string, number>
  raw: unknown
}

export interface Provider {
  id: string
  kind: ProviderKind
  models: string[]
  generate(req: GenRequest, cfg: ProviderConfig, signal?: AbortSignal): Promise<GenResult>
  edit?(req: GenRequest, cfg: ProviderConfig, signal?: AbortSignal): Promise<GenResult>
}
```

## 四、index.js 骨架（可直接跑）

```js
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { Schema } from 'schemastery'
import { providerTable } from './providers/index.js'

export const name = 'image-gen'
export const inject = ['tools']

export const Config = Schema.object({
  defaultProvider: Schema.string().default('openai'),
  outputDir: Schema.string().default('outputs/images'),
  timeoutMs: Schema.number().default(120000),
  maxRetries: Schema.number().default(4),
  providers: Schema.dict(
    Schema.object({
      apiKey: Schema.string().role('secret'),
      baseUrl: Schema.string(),
      model: Schema.string(),
      apiVersion: Schema.string(),
      region: Schema.string(),
      concurrency: Schema.number().default(2),
    }),
  ).default({}),
})

const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

function fileNameFor(provider, model, prompt, seed) {
  const h = createHash('sha256').update(`${provider}|${model}|${prompt}|${seed ?? ''}`).digest('hex')
  return h.slice(0, 24)
}

async function persist(root, images, meta) {
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  const dir = resolve(root, day)
  await mkdir(dir, { recursive: true })
  const out = []
  for (const [i, img] of images.entries()) {
    const base = `${fileNameFor(meta.provider, meta.model, meta.prompt, meta.seed)}-${i}`
    const file = join(dir, `${base}.${MIME_EXT[img.mime] ?? 'png'}`)
    await writeFile(file, img.bytes)
    await writeFile(join(dir, `${base}.json`), JSON.stringify({ ...meta, file, mime: img.mime }, null, 2))
    out.push({ ...img, path: file })
  }
  return out
}

export function apply(ctx, config) {
  async function run(args, signal) {
    const providerId = args.provider ?? config.defaultProvider
    const provider = providerTable[providerId]
    if (!provider) throw new Error(`provider ${providerId} 未注册`)
    const cfg = { ...(config.providers?.[providerId] ?? {}), model: args.model ?? config.providers?.[providerId]?.model }
    if (!cfg.apiKey) throw new Error(`provider ${providerId} 缺 apiKey`)
    if (!cfg.model) throw new Error(`provider ${providerId} 缺 model`)

    const req = {
      prompt: args.prompt,
      negativePrompt: args.negative_prompt,
      aspect: args.aspect,
      width: args.width,
      height: args.height,
      n: args.n ?? 1,
      seed: args.seed,
      refImages: args.reference_images,
      extra: args.extra,
    }
    const fn = args.mode === 'edit' && provider.edit ? provider.edit : provider.generate
    const res = await fn.call(provider, req, { ...cfg, timeoutMs: config.timeoutMs, maxRetries: config.maxRetries }, signal)
    if (res.blocked) return { ...res, images: [] }
    const saved = await persist(config.outputDir, res.images, {
      provider: res.provider,
      model: res.model,
      prompt: req.prompt,
      seed: res.seed,
      aspect: req.aspect,
      createdAt: new Date().toISOString(),
    })
    return { ...res, images: saved }
  }

  ctx.tools.register({
    name: 'image_generate',
    description: '按文字描述生成图片，本地落盘并返回文件路径。支持多家厂商，provider 不填走默认。',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '画面描述，建议英文长句，含主体/风格/光线/镜头' },
        provider: { type: 'string', description: '厂商 id，如 openai / gemini / ark / dashscope / fal / stability / replicate' },
        model: { type: 'string', description: '模型名，省略则用配置里的默认值' },
        negative_prompt: { type: 'string', description: '不要出现的内容' },
        aspect: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '21:9'], description: '画面比例' },
        width: { type: 'integer', description: '像素宽，与 aspect 二选一' },
        height: { type: 'integer', description: '像素高，与 aspect 二选一' },
        n: { type: 'integer', description: '张数，默认 1' },
        seed: { type: 'integer', description: '随机种子，固定后同 prompt 出同图' },
        reference_images: { type: 'array', items: { type: 'string' }, description: '参考图本地路径或 http URL，用于图生图或改图' },
        mode: { type: 'string', enum: ['generate', 'edit'], description: 'edit 走改图分支' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          provider: { type: 'string' },
          model: { type: 'string' },
          seed: { type: 'integer' },
          paths: { type: 'array', items: { type: 'string' } },
        },
      },
      render(args, value) {
        if (!value.paths?.length) {
          return [{ type: 'text', text: `出图被拦：${value.blocked?.code ?? 'unknown'} ${value.blocked?.message ?? ''}` }]
        }
        return [{
          type: 'text',
          text: [`${value.provider}/${value.model} 出 ${value.paths.length} 张，seed=${value.seed ?? '-'}`,
            ...value.paths.map((p) => `![生成结果](${p})`)].join('\n\n'),
        }]
      },
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const res = await run(args, exec.signal)
      return {
        provider: res.provider,
        model: res.model,
        seed: res.seed,
        paths: res.images.map((i) => i.path),
        blocked: res.blocked,
      }
    },
  })

  ctx.tools.register({
    name: 'image_providers',
    description: '列出已注册的生图厂商、各自支持的模型与协议形态。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object' } } } },
      render(_args, value) {
        return [{ type: 'text', text: value.items.map((i) => `${i.id}\t${i.kind}\t${i.models.join(',')}`).join('\n') }]
      },
    },
    isConcurrencySafe: () => true,
    async execute() {
      return {
        items: Object.values(providerTable).map((p) => ({ id: p.id, kind: p.kind, models: p.models })),
      }
    },
  })
}
```

## 五、统一 fetch（重试与超时集中在这里）

```js
// providers/_http.js
export async function requestJson(url, init, { timeoutMs = 120000, maxRetries = 4, signal } = {}) {
  let wait = 1000
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    const onAbort = () => ac.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const res = await fetch(url, { ...init, signal: ac.signal })
      if (res.status === 429 || res.status >= 500) {
        if (attempt === maxRetries) throw new Error(`${res.status} after ${maxRetries} retries: ${await res.text()}`)
        await new Promise((r) => setTimeout(r, wait))
        wait = Math.min(wait * 2, 8000)
        continue
      }
      if (!res.ok) {
        const body = await res.text()
        throw Object.assign(new Error(`HTTP ${res.status}: ${body}`), { status: res.status, body })
      }
      return await res.json()
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

export async function downloadBytes(url, { timeoutMs = 60000 } = {}) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ac.signal })
    if (!res.ok) throw new Error(`download ${res.status}`)
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      mime: res.headers.get('content-type')?.split(';')[0] ?? 'image/png',
    }
  } finally {
    clearTimeout(timer)
  }
}

export const b64ToBytes = (b64) => new Uint8Array(Buffer.from(b64, 'base64'))
```

## 六、三家代表实现（覆盖三种协议形态）

```js
// providers/openai.js —— 同步 b64
export const openai = {
  id: 'openai',
  kind: 'sync-b64',
  models: ['gpt-image-1', 'dall-e-3', 'dall-e-2'],
  async generate(req, cfg, signal) {
    const body = {
      model: cfg.model,
      prompt: req.prompt,
      n: req.n ?? 1,
      size: cfg.model === 'dall-e-3' ? '1792x1024' : sizeToOpenAI(req),
      quality: cfg.model === 'dall-e-3' ? 'hd' : 'high',
      output_format: 'png',
    }
    if (cfg.model === 'dall-e-3') body.response_format = 'b64_json'
    const json = await requestJson('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, { timeoutMs: cfg.timeoutMs, maxRetries: cfg.maxRetries, signal })
    return {
      provider: 'openai', model: cfg.model, kind: 'sync-b64',
      images: json.data.map((d) => ({ bytes: b64ToBytes(d.b64_json), mime: 'image/png', revisedPrompt: d.revised_prompt })),
      usage: json.usage, raw: json,
    }
  },
}

function sizeToOpenAI(req) {
  const map = { '1:1': '1024x1024', '16:9': '1536x1024', '9:16': '1024x1536', '4:3': '1536x1024', '3:4': '1024x1536', '3:2': '1536x1024' }
  if (req.width && req.height) return `${req.width}x${req.height}`
  return map[req.aspect ?? '1:1'] ?? '1024x1024'
}
```

```js
// providers/gemini.js —— 同步 b64，结果藏在 parts 里
export const gemini = {
  id: 'gemini',
  kind: 'sync-b64',
  models: ['gemini-2.5-flash-image', 'gemini-3-pro-image-preview'],
  async generate(req, cfg, signal) {
    const parts = []
    for (const ref of req.refImages ?? []) {
      const b64 = ref.startsWith('data:') ? ref.split(',')[1] : (await readAsBase64(ref))
      parts.push({ inline_data: { mime_type: 'image/png', data: b64 } })
    }
    parts.push({ text: req.prompt })
    const json = await requestJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': cfg.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: req.aspect ?? '1:1' } },
        }),
      },
      { timeoutMs: cfg.timeoutMs, maxRetries: cfg.maxRetries, signal },
    )
    const all = json.candidates?.[0]?.content?.parts ?? []
    const images = all.filter((p) => p.inlineData).map((p) => ({ bytes: b64ToBytes(p.inlineData.data), mime: p.inlineData.mimeType }))
    const blocked = images.length ? undefined
      : { code: json.candidates?.[0]?.finishReason ?? 'EMPTY', message: '模型未返回图像部分' }
    return { provider: 'gemini', model: cfg.model, kind: 'sync-b64', images, blocked, raw: json }
  },
}
```

```js
// providers/ark.js —— 同步 url（Seedream），也可开 SSE
export const ark = {
  id: 'ark',
  kind: 'sync-url',
  models: ['doubao-seedream-4-0-250828', 'doubao-seedream-3-0-t2i-250415'],
  async generate(req, cfg, signal) {
    const body = {
      model: cfg.model,
      prompt: req.prompt,
      size: req.aspect === '1:1' ? '2048x2048' : '2K',
      response_format: 'url',
      watermark: false,
      seed: req.seed,
      guidance_scale: 2.5,
    }
    if (req.refImages?.length) body.image = req.refImages
    const json = await requestJson(`${cfg.baseUrl ?? 'https://ark.cn-beijing.volces.com/api/v3'}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, { timeoutMs: cfg.timeoutMs, maxRetries: cfg.maxRetries, signal })
    const images = []
    for (const d of json.data ?? []) {
      const got = d.b64_json ? { bytes: b64ToBytes(d.b64_json), mime: 'image/png' } : await downloadBytes(d.url)
      images.push(got)
    }
    return { provider: 'ark', model: cfg.model, kind: 'sync-url', images, seed: json.seed, usage: json.usage, raw: json }
  },
}
```

异步族的轮询器（万相 / BFL / MJ 通用）：

```js
// providers/_poll.js
export async function poll(fn, { intervalMs = 1000, maxMs = 120000, factor = 1.5, cap = 5000, signal } = {}) {
  const deadline = Date.now() + maxMs
  let wait = intervalMs
  while (Date.now() < deadline) {
    const out = await fn()
    if (out?.done) return out
    if (signal?.aborted) throw new Error('aborted')
    await new Promise((r) => setTimeout(r, wait))
    wait = Math.min(wait * factor, cap)
  }
  throw new Error(`poll timeout after ${maxMs}ms`)
}

// 用法（万相）
const created = await requestJson('https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis', {
  method: 'POST',
  headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
  body: JSON.stringify({ model: cfg.model, input: { prompt: req.prompt }, parameters: { size: '1024*1024', n: req.n ?? 1 } }),
})
const final = await poll(async () => {
  const j = await requestJson(`https://dashscope.aliyuncs.com/api/v1/tasks/${created.output.task_id}`, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
  })
  if (j.output.task_status === 'SUCCEEDED') return { done: true, value: j }
  if (j.output.task_status === 'FAILED') throw new Error(`task failed: ${JSON.stringify(j.output)}`)
  return { done: false }
}, { signal })
```

## 七、配置项设计

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `defaultProvider` | string | `openai` | 不传 provider 时用它 |
| `outputDir` | string | `outputs/images` | 相对会话工作目录，按日期分子目录 |
| `timeoutMs` | number | `120000` | 单次 HTTP 超时 |
| `maxRetries` | number | `4` | 429/5xx 重试次数 |
| `providers.<id>.apiKey` | secret | — | 走 `${env:XXX}` 或设置页填 |
| `providers.<id>.baseUrl` | string | 各家默认 | 中转站改这里 |
| `providers.<id>.model` | string | — | 默认模型 |
| `providers.<id>.apiVersion` | string | — | Azure 要用 |
| `providers.<id>.region` | string | — | 火山/腾讯/Vertex 要用 |
| `providers.<id>.concurrency` | number | `2` | 单家并发上限 |

key 的来源优先级：`config.providers.<id>.apiKey` → `process.env.<ID>_API_KEY` → `process.env.<ID>_KEY`。写日志时统一替换成 `sk-***`。

## 八、验收清单

1. `node --check index.js` 与 `node --check providers/openai.js` 全部通过
2. 没配 key 时 `image_providers` 能列出表，`image_generate` 报「缺 apiKey」而不是崩
3. 配好单家 key 后跑一张 1:1，磁盘出现 `<hash>-0.png` 和同名 `.json`
4. 同一 prompt + 同 seed 再跑，命中缓存不重复计费
5. 断网跑一次，看是否在 `timeoutMs` 内抛出而不是挂着
6. 429 用假 key 打一次，确认退避 4 次后才报错
7. 异步族（万相或 BFL）跑一次，确认轮询到终态才返回
8. 把 `size` 传成 `16:9`，确认落到厂商原生宽幅枚举而不是被拒
9. `install_bundle` 后 `application: applied`，`cordis_inspect_query` 能看到两个新 Tool
10. 设置页里插件的标题、描述、图标三项都正确显示
