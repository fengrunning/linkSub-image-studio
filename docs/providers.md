# 生图 API 规格全集（按协议形态归类）

所有路径均为 2025-11 时的线上地址。厂商会改模型名，写代码时把 model 与 size 做成配置项，路径尽量只写一次。

---

## 0. 协议形态只有三类

| 形态 | 判定特征 | 你的适配层实现方式 |
|---|---|---|
| A. 同步 Base64 | 一次 HTTP 往返，响应里直接给 `b64_json` / `image` / `bytesBase64Encoded` | 直接 base64 解码落盘 |
| B. 同步 URL | 一次 HTTP 往返，响应里给 `url`（多为临时 CDN 链接，1 小时~24 小时过期） | 立刻下载到本地，别把 URL 当结果返回 |
| C. 异步任务 | 提交拿 `task_id` / `id` / `polling_url`，再轮询或等 webhook | 提交 → sleep/backoff 轮询 → 取结果 URL → 落盘 |

插件里必须有这三种形态，缺一类就有一半厂商接不进来。

## 1. 鉴权头速查

| 厂商 | 头 | 备注 |
|---|---|---|
| OpenAI / Azure 之外的多数 | `Authorization: Bearer <KEY>` | 最通用 |
| Azure OpenAI | `api-key: <KEY>` | 走 `?api-version=`，无 `Bearer` |
| Google Gemini / Vertex API Key 模式 | `x-goog-api-key: <KEY>` 或 `?key=<KEY>` | Vertex 正式模式走 OAuth2 `Bearer`（`gcloud auth print-access-token`） |
| Stability AI | `Authorization: Bearer sk-...` | 还要 `Accept: image/*` 拿二进制 |
| Black Forest Labs | `x-key: <KEY>` | 头名就叫 x-key |
| Ideogram | `Api-Key: <KEY>` | 不是 Bearer |
| FAL | `Authorization: Key <FAL_KEY>` | 前缀是 `Key` 不是 `Bearer` |
| 腾讯混元 | TC3-HMAC-SHA256 签名 | 要自己算签名，见第 8 节 |
| 百度千帆 | `?access_token=` query | 先用 AK/SK 换 token，30 天有效 |
| Midjourney 代理 | 各家自定，常见 `X-API-KEY` | 无官方 API |

## 2. OpenAI / 通用 `/v1/images/generations` 族

### 2.1 OpenAI 官方

```
POST https://api.openai.com/v1/images/generations
Authorization: Bearer $OPENAI_API_KEY
Content-Type: application/json

{
  "model": "gpt-image-1",
  "prompt": "a red fox in snow, 35mm photo",
  "n": 1,
  "size": "1024x1024",
  "quality": "high",
  "background": "opaque",
  "output_format": "png",
  "output_compression": 100,
  "moderation": "auto",
  "stream": false
}
```

gpt-image-1 的取值：
- `size`: `1024x1024` / `1536x1024` / `1024x1536` / `auto`
- `quality`: `low` / `medium` / `high` / `auto`
- `background`: `transparent` / `opaque` / `auto`
- `output_format`: `png` / `jpeg` / `webp`
- 只回 `b64_json`，没有 `url` 字段，也没有 `response_format` 入参

响应：

```json
{
  "created": 1741476542,
  "data": [{ "b64_json": "iVBORw0KGgo..." }],
  "usage": { "input_tokens": 50, "output_tokens": 4160, "total_tokens": 4210 }
}
```

dall-e-3 的差异：
- `size`: `1024x1024` / `1792x1024` / `1024x1792`
- `quality`: `standard` / `hd`，另加 `style`: `natural` / `vivid`
- 有 `response_format`: `url` / `b64_json`
- `n` 固定 1
- 响应多一个 `revised_prompt`

图片编辑：

```
POST https://api.openai.com/v1/images/edits
Content-Type: multipart/form-data
Authorization: Bearer $OPENAI_API_KEY
```

form 字段：`image`（gpt-image-1 可重复传多张 `image[]`，单张 ≤25MB，png/webp/jpg）、`mask`（png，透明区为重绘区）、`prompt`、`model`、`size`、`n`、`quality`。

变体（只有 dall-e-2）：`POST /v1/images/variations`，form 字段 `image` + `n` + `size`。

### 2.2 Azure OpenAI

```
POST https://{resource}.openai.azure.com/openai/deployments/{deployment}/images/generations?api-version=2025-04-01-preview
api-key: $AZURE_OPENAI_KEY
Content-Type: application/json
```

body 与 OpenAI 一致，`model` 位填 deployment 名。新版 v1 预览通道也支持 `POST https://{resource}.openai.azure.com/openai/v1/images/generations`。

### 2.3 xAI Grok

```
POST https://api.x.ai/v1/images/generations
Authorization: Bearer $XAI_API_KEY

{ "model": "grok-2-image", "prompt": "...", "n": 1, "response_format": "url" }
```

响应：`{"data":[{"url":"https://...","revised_prompt":"..."}]}`

### 2.4 Together AI

```
POST https://api.together.xyz/v1/images/generations
Authorization: Bearer $TOGETHER_KEY

{
  "model": "black-forest-labs/FLUX.1-schnell-Free",
  "prompt": "...",
  "width": 1024,
  "height": 1024,
  "steps": 4,
  "n": 1,
  "response_format": "b64_json",
  "seed": 0
}
```

响应：`{"id":"...","model":"...","data":[{"b64_json":"..."}]}`

### 2.5 硅基流动 SiliconFlow

```
POST https://api.siliconflow.cn/v1/images/generations
Authorization: Bearer $SILICONFLOW_KEY

{
  "model": "Kwai-Kolors/Kolors",
  "prompt": "...",
  "negative_prompt": "",
  "image_size": "1024x1024",
  "batch_size": 1,
  "num_inference_steps": 20,
  "guidance_scale": 7.5,
  "seed": 499999999
}
```

响应：`{"images":[{"url":"https://..."}],"timings":{"inference":1.23},"seed":499999999}`

`image_size` 是枚举：`1024x1024` / `960x1280` / `768x1024` / `720x1440` / `720x1280` / `1280x720` / `1440x720` / `1024x768` / `1280x960` / `512x1024` / `768x512` / `512x768` / `576x1024` / `1024x576`。

### 2.6 智谱 CogView

```
POST https://open.bigmodel.cn/api/paas/v4/images/generations
Authorization: Bearer $ZHIPU_KEY

{ "model": "cogview-4-250304", "prompt": "...", "size": "1024x1024", "quality": "standard", "user_id": "u1" }
```

响应：`{"created":..,"data":[{"url":"https://..."}]}`

`size` 枚举：`1024x1024` / `768x1344` / `864x1152` / `1344x768` / `1152x864` / `1440x720` / `720x1440`。`quality`: `standard` / `hd`。

### 2.7 火山方舟 Seedream（豆包生图）

```
POST https://ark.cn-beijing.volces.com/api/v3/images/generations
Authorization: Bearer $ARK_API_KEY
Content-Type: application/json

{
  "model": "doubao-seedream-4-0-250828",
  "prompt": "...",
  "image": ["https://你的参考图.jpg"],
  "size": "2K",
  "response_format": "url",
  "watermark": false,
  "sequential_image_generation": "disabled",
  "stream": false,
  "seed": 123,
  "guidance_scale": 2.5
}
```

响应：

```json
{
  "model": "doubao-seedream-4-0-250828",
  "created": 1741476542,
  "data": [{ "url": "https://...", "size": "2048x2048" }],
  "usage": { "generated_images": 1, "output_tokens": 16384, "total_tokens": 16384 }
}
```

- `size` 支持 `1K` / `2K` / `4K` 或直接给 `宽x高`（每边 1280~4096 像素）
- `image` 传参考图数组即图生图 / 多图融合，`sequential_image_generation: "auto"` 开组图
- Seedream 3.0 的 model 是 `doubao-seedream-3-0-t2i-250415`，`size` 走像素枚举，无 `image` 组图
- `stream: true` 时返回 SSE，事件名 `image_generation.partial_succeeded` / `image_generation.completed`

### 2.8 通义万相 DashScope 兼容模式

```
POST https://dashscope.aliyuncs.com/compatible-mode/v1/images/generations
Authorization: Bearer $DASHSCOPE_KEY

{ "model": "wanx2.1-t2i-turbo", "prompt": "...", "size": "1024x1024", "n": 1 }
```

兼容层内部仍是异步任务，响应形态是 `data[].url`，慢一点；要精确控制异步节奏用第 7 节的原始接口。

### 2.9 MiniMax

```
POST https://api.minimax.chat/v1/image_generation
Authorization: Bearer $MINIMAX_KEY

{
  "model": "image-01",
  "prompt": "...",
  "aspect_ratio": "1:1",
  "response_format": "url",
  "n": 1,
  "prompt_optimizer": true,
  "seed": 123
}
```

响应：

```json
{
  "id": "...",
  "data": { "image_urls": ["https://..."] },
  "metadata": { "success_count": "1", "failed_count": "0" },
  "base_resp": { "status_code": 0, "status_msg": "" }
}
```

`aspect_ratio` 枚举：`1:1` / `16:9` / `4:3` / `3:2` / `2:3` / `3:4` / `9:16` / `21:9`。同时也可写 `width`/`height`（512~2048，8 的倍数）。

---

## 3. Google Gemini / Imagen

### 3.1 Gemini 原生图像（nano banana）

```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent
x-goog-api-key: $GEMINI_API_KEY
Content-Type: application/json

{
  "contents": [{ "role": "user", "parts": [{ "text": "a cat wearing sunglasses, studio light" }] }],
  "generationConfig": {
    "responseModalities": ["IMAGE"],
    "imageConfig": { "aspectRatio": "16:9", "imageSize": "2K" }
  }
}
```

响应（图片在 parts 里，不固定第几个）：

```json
{
  "candidates": [{
    "content": { "parts": [
      { "inlineData": { "mimeType": "image/png", "data": "iVBORw0KGgo..." } }
    ]},
    "finishReason": "STOP"
  }],
  "usageMetadata": { "promptTokenCount": 12, "candidatesTokenCount": 1290, "totalTokenCount": 1302 }
}
```

图生图 / 改图：在 `parts` 里加一张参考图，base64 走 `inline_data`：

```json
"parts": [
  { "inline_data": { "mime_type": "image/png", "data": "<base64>" } },
  { "text": "把背景换成海边" }
]
```

模型名：`gemini-2.5-flash-image`（快、便宜）、`gemini-3-pro-image-preview`（nano banana pro，4K、文字准确）。`imageConfig.imageSize` 取值 `1K` / `2K` / `4K`。

### 3.2 Imagen 4（Vertex AI predict）

```
POST https://{REGION}-aiplatform.googleapis.com/v1/projects/{PROJECT}/locations/{REGION}/publishers/google/models/imagen-4.0-generate-001:predict
Authorization: Bearer $ACCESS_TOKEN

{
  "instances": [{ "prompt": "..." }],
  "parameters": {
    "sampleCount": 1,
    "aspectRatio": "1:1",
    "negativePrompt": "",
    "seed": 0,
    "personGeneration": "allow_adult",
    "safetySetting": "block_medium_and_above",
    "outputOptions": { "mimeType": "image/jpeg", "compressionQuality": 90 }
  }
}
```

响应：

```json
{ "predictions": [{ "bytesBase64Encoded": "...", "mimeType": "image/jpeg" }] }
```

`aspectRatio` 枚举：`1:1` / `3:4` / `4:3` / `9:16` / `16:9`。`sampleCount` 上限 4。

---

## 4. Stability AI

```
POST https://api.stability.ai/v2beta/stable-image/generate/ultra
Authorization: Bearer $STABILITY_KEY
Accept: image/*
Content-Type: multipart/form-data
```

form 字段：`prompt`、`negative_prompt`、`aspect_ratio`（`1:1`/`16:9`/`21:9`/`2:3`/`3:2`/`4:5`/`5:4`/`9:16`/`9:21`）、`seed`、`output_format`（`png`/`jpeg`/`webp`）、`model`、`style_preset`。

生成档位路径：`.../generate/core`（SD Core）、`.../generate/sd3`、`.../generate/ultra`。

`Accept: image/*` 时直接返回图片字节；`Accept: application/json` 时：

```json
{ "image": "<base64>", "finish_reason": "SUCCESS", "seed": 123456 }
```

衍生接口（同形态、同鉴权）：
- `/v2beta/stable-image/edit/inpaint`（`image` + `mask` + `prompt`）
- `/v2beta/stable-image/edit/erase`
- `/v2beta/stable-image/edit/search-and-replace`
- `/v2beta/stable-image/control/sketch`
- `/v2beta/stable-image/upscale/fast`

---

## 5. Fal.ai

### 5.1 同步

```
POST https://fal.run/fal-ai/flux/dev
Authorization: Key $FAL_KEY
Content-Type: application/json

{
  "prompt": "...",
  "image_size": { "width": 1024, "height": 1024 },
  "num_images": 1,
  "seed": 42,
  "num_inference_steps": 28,
  "guidance_scale": 3.5,
  "enable_safety_checker": true,
  "output_format": "jpeg"
}
```

响应：

```json
{
  "images": [{ "url": "https://fal.media/files/...", "width": 1024, "height": 1024, "content_type": "image/jpeg" }],
  "seed": 42,
  "has_nsfw_concepts": [false],
  "timings": { "inference": 1.9 },
  "prompt": "..."
}
```

`image_size` 也接受字符串枚举：`square_hd` / `square` / `portrait_4_3` / `portrait_16_9` / `landscape_4_3` / `landscape_16_9`。

### 5.2 队列（长任务走这个）

```
POST https://queue.fal.run/fal-ai/flux/dev
```

响应：

```json
{
  "request_id": "abc",
  "status_url": "https://queue.fal.run/fal-ai/flux/requests/abc/status",
  "response_url": "https://queue.fal.run/fal-ai/flux/requests/abc"
}
```

轮询 `status_url` → `{"status":"IN_QUEUE"|"IN_PROGRESS"|"COMPLETED","queue_position":0}`；`COMPLETED` 后 GET `response_url` 拿同步形态的结果体。webhook 用 `?fal_webhook=https://...` 或头 `X-Fal-Webhook-Url`。

---

## 6. Black Forest Labs（FLUX 官方）

```
POST https://api.bfl.ai/v1/flux-pro-1.1
x-key: $BFL_API_KEY
Content-Type: application/json

{
  "prompt": "...",
  "width": 1024,
  "height": 1024,
  "prompt_upsampling": false,
  "seed": 42,
  "safety_tolerance": 2,
  "output_format": "jpeg",
  "steps": 50,
  "guidance": 3
}
```

提交返回：

```json
{ "id": "b7c1...", "polling_url": "https://api.bfl.ai/v1/get_result?id=b7c1..." }
```

轮询：

```json
{ "id": "b7c1...", "status": "Ready", "result": { "sample": "https://delivery.bfl.ai/..." } }
```

`status` 取值 `Pending` / `Ready` / `Error` / `Content Moderated` / `Request Moderated`。改图模型 `flux-kontext-pro` / `flux-kontext-max`，body 加 `input_image`（URL 或 base64）。模型段还有 `flux-dev` / `flux-pro` / `flux-1.1-pro`。

---

## 7. 异步任务族

### 7.1 通义万相 DashScope 原始异步接口

提交：

```
POST https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis
Authorization: Bearer $DASHSCOPE_KEY
X-DashScope-Async: enable
Content-Type: application/json

{
  "model": "wanx2.1-t2i-turbo",
  "input": { "prompt": "...", "negative_prompt": "" },
  "parameters": { "size": "1024*1024", "n": 1, "seed": 123, "prompt_extend": true, "watermark": false }
}
```

响应：

```json
{ "output": { "task_id": "86ecf553-...", "task_status": "PENDING" }, "request_id": "..." }
```

轮询：

```
GET https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}
Authorization: Bearer $DASHSCOPE_KEY
```

```json
{
  "output": {
    "task_id": "...",
    "task_status": "SUCCEEDED",
    "results": [{ "url": "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/....png" }]
  },
  "usage": { "image_count": 1 }
}
```

注意 `size` 用星号 `1024*1024`，跟 OpenAI 的 `1024x1024` 不同。模型：`wanx2.1-t2i-turbo` / `wanx2.1-t2i-plus` / `wan2.2-t2i-flash` / `wan2.2-t2i-plus`。

### 7.2 腾讯混元生图（TC3 签名）

接口：`POST https://hunyuan.tencentcloudapi.com`，`Service=hunyuan`、`Version=2023-09-01`、`Action=TextToImage`、`Region=ap-guangzhou`。

body：

```json
{ "Prompt": "...", "Style": "<风格ID>", "Resolution": "1024:1024", "Num": 1, "LogoAdd": 0 }
```

响应 `{"JobId":"...","RequestId":"..."}`，再提交 `Action=QueryTextToImageJob` + `{"JobId":"..."}` 取 `JobStatusCode` 与 `ResultImage`。

签名算法（TC3-HMAC-SHA256，四步）：
1. 拼规范请求串 `CanonicalRequest = HTTPMethod + "\n" + CanonicalURI + "\n" + CanonicalQueryString + "\n" + CanonicalHeaders + "\n" + SignedHeaders + "\n" + HashedRequestPayload`
2. 拼待签串 `StringToSign = "TC3-HMAC-SHA256" + "\n" + Timestamp + "\n" + CredentialScope + "\n" + SHA256(CanonicalRequest)`
3. 逐级派生密钥 `kDate = HMAC("TC3" + SecretKey, Date)` → `kService = HMAC(kDate, Service)` → `kSigning = HMAC(kService, "tc3_request")`
4. `Signature = HMAC(kSigning, StringToSign)` 的 hex，塞进 `Authorization: TC3-HMAC-SHA256 Credential=<SecretId>/<Date>/<Service>/tc3_request, SignedHeaders=content-type;host, Signature=<...>`，同时带 `X-TC-Action` / `X-TC-Version` / `X-TC-Timestamp` / `X-TC-Region`。

### 7.3 百度千帆 / 文心一格

换 token：

```
POST https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=$AK&client_secret=$SK
```

```json
{ "access_token": "24.xxxx", "expires_in": 2592000 }
```

提交：

```
POST https://aip.baidubce.com/rpc/2.0/ernievilg/v1/txt2img?access_token=$TOKEN
Content-Type: application/json

{ "prompt": "...", "width": 1024, "height": 1024, "image_num": 1, "style": "<风格名>" }
```

响应 `{"data":{"taskId":123456}}`，轮询 `POST /rpc/2.0/ernievilg/v1/getImg?access_token=$TOKEN` + `{"taskId":123456}`，`data.task_status` 为 `SUCCESS` 时读 `data.imgUrls`。

### 7.4 Midjourney（走第三方代理）

MJ 官方没有公开 API。代理的调用骨架统一是「提交 → 轮询 → 追加 action」。

以 GoAPI 为例：

```
POST https://api.goapi.ai/mj/v2/imagine
X-API-KEY: $GOAPI_KEY

{ "task_type": "imagine", "input": { "prompt": "a cat --ar 16:9 --v 6.1" } }
```

→ `{"code":0,"data":{"task_id":"..."}}`

```
GET https://api.goapi.ai/mj/v2/fetch?task_id=...
```

→ `{"status":"finished","output":{"image_url":"https://...","progress":100}}`

放大 / 变体：再提交一次，`task_type` 换 `upscale` / `variation`，`input` 里带 `origin_task_id` 和 `index`（1~4）。

同类代理：PiAPI（`https://api.piapi.ai/api/mj/v1/task`）、Midjourney-Proxy（`https://你的域名/mj/submit/imagine` + `/mj/task/{id}/fetch`）。

---

## 8. Ideogram / Recraft / Cloudflare

### 8.1 Ideogram

```
POST https://api.ideogram.ai/generate
Api-Key: $IDEOGRAM_KEY
Content-Type: application/json

{
  "image_request": {
    "prompt": "...",
    "aspect_ratio": "ASPECT_1_1",
    "model": "V_2",
    "magic_prompt_option": "AUTO",
    "style_type": "REALISTIC",
    "negative_prompt": "",
    "num_images": 1,
    "seed": 0
  }
}
```

响应：

```json
{ "created": "..", "data": [{ "url": "https://...", "prompt": "...", "resolution": "1024x1024", "is_image_safe": true, "seed": 0, "style_type": "REALISTIC" }] }
```

`aspect_ratio` 是 `ASPECT_1_1` / `ASPECT_16_9` / `ASPECT_9_16` / `ASPECT_3_2` / `ASPECT_2_3` / `ASPECT_4_3` / `ASPECT_3_4` / `ASPECT_10_16` / `ASPECT_16_10` 这种带前缀的写法，跟别家都不一样。模型：`V_1` / `V_1_TURBO` / `V_2` / `V_2_TURBO` / `V_3`。remix 走 `/remix`，编辑走 `/edit`（multipart）。

### 8.2 Recraft

```
POST https://external.api.recraft.ai/v1/images/generations
Authorization: Bearer $RECRAFT_KEY

{ "prompt": "...", "style": "realistic_image", "size": "1024x1024", "n": 1, "response_format": "url" }
```

响应 `{"created":..,"data":[{"url":"..."}]}`。`style` 三族：`realistic_image` / `digital_illustration` / `vector_illustration`，下面还挂 `_b_and_w` / `_enterprise` / `_hdr` 等子风格。

### 8.3 Cloudflare Workers AI

```
POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/@cf/black-forest-labs/flux-1-schnell
Authorization: Bearer $CF_API_TOKEN

{ "prompt": "...", "steps": 4 }
```

返回体默认是二进制图片字节（`Content-Type: image/jpeg`），响应不是 JSON，适配层要按字节读。

---

## 9. Replicate

```
POST https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions
Authorization: Bearer $REPLICATE_TOKEN
Content-Type: application/json
Prefer: wait

{ "input": { "prompt": "...", "aspect_ratio": "1:1", "output_format": "webp", "output_quality": 90, "safety_tolerance": 2 } }
```

带 `Prefer: wait` 时最多等 60 秒直接回终态：

```json
{
  "id": "xyz",
  "status": "succeeded",
  "output": ["https://replicate.delivery/....webp"],
  "urls": { "get": "https://api.replicate.com/v1/predictions/xyz", "cancel": "https://api.replicate.com/v1/predictions/xyz/cancel" }
}
```

不带 `Prefer: wait` 时首包是 `starting`，轮询 `urls.get` 直到 `succeeded` / `failed` / `canceled`。webhook 用 `"webhook": "https://...", "webhook_events_filter": ["completed"]`。也能用通用入口 `POST /v1/predictions` + `{"version":"<hash>","input":{...}}`。

---

## 10. 本地 / 自建

### 10.1 ComfyUI

```
POST http://127.0.0.1:8188/prompt
Content-Type: application/json

{ "prompt": { /* API 格式 workflow JSON，节点 id 为 key */ }, "client_id": "uuid-xxxx" }
```

响应 `{"prompt_id":"...","number":1,"node_errors":{}}`。进度监听 `ws://127.0.0.1:8188/ws?clientId=uuid-xxxx`（事件 `executing` / `progress` / `executed`），或轮询 `GET http://127.0.0.1:8188/history/{prompt_id}` 读 `outputs.<nodeId>.images[].filename`，再 `GET http://127.0.0.1:8188/view?filename=x.png&subfolder=&type=output` 取字节。

### 10.2 Stable Diffusion WebUI (A1111 / Forge)

```
POST http://127.0.0.1:7860/sdapi/v1/txt2img

{
  "prompt": "...",
  "negative_prompt": "",
  "steps": 28,
  "width": 1024,
  "height": 1024,
  "cfg_scale": 7,
  "sampler_name": "DPM++ 2M Karras",
  "seed": -1,
  "batch_size": 1,
  "n_iter": 1,
  "save_images": false
}
```

响应 `{"images":["<base64>"],"parameters":{},"info":"{...}"}`。图生图 `/sdapi/v1/img2img`（多 `init_images: [base64]` 和 `denoising_strength`）。

---

## 11. 字段归一表（适配层内部只用这一套）

| 内部字段 | OpenAI | Gemini | Stability | Seedream | DashScope | Fal | BFL | Replicate |
|---|---|---|---|---|---|---|---|---|
| `prompt` | `prompt` | `contents[].parts[].text` | `prompt` | `prompt` | `input.prompt` | `prompt` | `prompt` | `input.prompt` |
| `negativePrompt` | 无 | 写进 text | `negative_prompt` | 无 | `input.negative_prompt` | `negative_prompt` | `negative_prompt` | `input.negative_prompt` |
| `size` | `1024x1024` | `aspectRatio` | `aspect_ratio` | `2K` / `宽x高` | `1024*1024` | `image_size` 对象 | `width`+`height` | `aspect_ratio` |
| `n` | `n` | 多候选 | `n`（多次调用） | 组图开关 | `parameters.n` | `num_images` | 无 | `num_outputs` |
| `seed` | 无 | `seed` | `seed` | `seed` | `parameters.seed` | `seed` | `seed` | `input.seed` |
| `guidance` | 无 | 无 | 无 | `guidance_scale` | 无 | `guidance_scale` | `guidance` | `input.guidance` |
| 结果 | `data[].b64_json` | `parts[].inlineData.data` | `image` 或二进制 | `data[].url` | `output.results[].url` | `images[].url` | 轮询 `result.sample` | `output[]` |

## 12. 抽象尺寸表

内部只暴露比例名，各家自己映射：

| 比例 | 像素 | OpenAI | DashScope | Stability / Fal | Imagen |
|---|---|---|---|---|---|
| `1:1` | 1024x1024 | `1024x1024` | `1024*1024` | `1:1` | `1:1` |
| `16:9` | 1536x864 | `1536x1024` 近似 | `1280*720` | `16:9` | `16:9` |
| `9:16` | 864x1536 | `1024x1536` 近似 | `720*1280` | `9:16` | `9:16` |
| `4:3` | 1152x864 | `1024x1024` 裁 | `1152*864` | `4:3` | `4:3` |
| `3:4` | 864x1152 | `1024x1024` 裁 | `864*1152` | `3:4` | `3:4` |
| `3:2` | 1536x1024 | `1536x1024` | `1536*1024` | `3:2` | `3:2` |
| `21:9` | 1536x640 | 无 | `1680*720` | `21:9` | 无 |

映射规则：优先用厂商原生枚举；没有原生比例时，取宽度最近的档然后本地裁切。

## 13. 错误码与退避

| 状态码 / 字段 | 含义 | 适配层动作 |
|---|---|---|
| 400 + `error.code=invalid_parameter` | 参数不合法 | 直接抛给调用方，带原始 message |
| 401 / 403 | key 错或过期 | 换下一个 key，全挂则整体报错 |
| 429 | 限流 | 指数退避 1s→2s→4s→8s，最多 4 次 |
| 500 / 502 / 503 | 服务端抖 | 同上退避重试 |
| 200 但 `finish_reason=CONTENT_FILTERED` | 内容被拦 | 归一为 `blocked`，附原始 code |
| 200 但 `has_nsfw_concepts=[true]` | 图片被判不雅 | 归一为 `blocked` |
| 200 但 `base_resp.status_code != 0` | MiniMax 业务错 | 读出 `status_msg` |
| 200 但 `code != 0` | 代理类业务错 | 读出 `message` |

轮询上限：视频类 600 秒、图片类 120 秒、间隔从 1 秒起每次 ×1.5，到 5 秒封顶。
