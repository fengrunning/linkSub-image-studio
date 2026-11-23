/**
 * Definition of the image generation protocols, dimension mapping, and the
 * request/response normalization used by every protocol adapter.
 *
 * Three wire shapes exist: one-shot base64, one-shot URL, and asynchronous
 * task polling. Each adapter returns the same shape so the page and the agent
 * tool never branch on the vendor.
 */

/** Aspect ratios the page offers, with their width/height divisor. */
export const RATIOS = {
  '1:1': [1, 1],
  '4:3': [4, 3],
  '3:2': [3, 2],
  '16:9': [16, 9],
  '9:16': [9, 16],
  '4:5': [4, 5],
  '3:4': [3, 4],
  '2:3': [2, 3],
  '21:9': [21, 9],
}

/** Ratios the Gemini image config accepts, in its own vocabulary. */
const GEMINI_ASPECTS = ['1:1', '4:3', '3:2', '16:9', '9:16', '4:5', '3:4', '2:3', '21:9']

/**
 * Parse an "a:b" ratio string, accepting a full-width colon as well.
 * @param value - ratio text such as `16:9`, `3:2`, or `2.35：1`.
 * @returns the two positive numbers, or undefined when the text is not a ratio.
 */
export function parseAspect(value) {
  if (typeof value !== 'string') return undefined
  const match = /^\s*(\d+(?:\.\d+)?)\s*[:：/]\s*(\d+(?:\.\d+)?)\s*$/.exec(value)
  if (match === null) return undefined
  const width = Number(match[1])
  const height = Number(match[2])
  if (!(width > 0) || !(height > 0)) return undefined
  return [width, height]
}

/**
 * Pick the entry of a fixed vocabulary closest to one ratio.
 * @param list - accepted ratio strings.
 * @param value - the requested ratio.
 * @returns the nearest accepted ratio.
 */
export function snapAspect(list, value) {
  const pair = parseAspect(value) ?? RATIOS[value] ?? RATIOS['1:1']
  const target = pair[0] / pair[1]
  let best = list[0]
  let delta = Infinity
  for (const item of list) {
    const [width, height] = item.split(':').map(Number)
    const distance = Math.abs(width / height - target)
    if (distance < delta) { delta = distance; best = item }
  }
  return best
}

/** Long-edge presets, in pixels. */
export const RESOLUTIONS = { '1K': 1024, '1.5K': 1536, '2K': 2048, '4K': 4096 }

/** Protocol ids the adapters implement. */
export const PROTOCOLS = ['auto', 'openai', 'gemini', 'ark', 'dashscope', 'openai-compat']

/** Protocol label shown in the page's protocol selector. */
export const PROTOCOL_LABELS = {
  auto: '自动推断',
  openai: 'OpenAI Images',
  gemini: 'Google Gemini',
  ark: '火山方舟 Seedream',
  dashscope: '通义万相',
  'openai-compat': 'OpenAI 兼容中转',
}

/** Protocol entries whose adapter accepts reference images. */
export const EDIT_CAPABLE = ['openai', 'openai-compat', 'gemini', 'ark']

const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

/** Legal OpenAI width/height pairs per model family. */
const OPENAI_SIZES = ['1024x1024', '1536x1024', '1024x1536']

/**
 * Resolve the requested dimension into pixel width and height.
 * @param input - page request carrying `aspect`, `resolution`, `width`, `height`.
 * @returns the resolved width and height in pixels.
 */
export function resolveSize(input) {
  const direct = Number(input.width) > 0 && Number(input.height) > 0
  if (direct) {
    return { width: Math.round(Number(input.width)), height: Math.round(Number(input.height)) }
  }
  const pair = parseAspect(input.aspect) ?? RATIOS[input.aspect] ?? RATIOS['1:1']
  const longEdge = RESOLUTIONS[input.resolution] ?? RESOLUTIONS['1K']
  const scale = longEdge / Math.max(pair[0], pair[1])
  const round = (n) => Math.max(64, Math.round((n * scale) / 8) * 8)
  return { width: round(pair[0]), height: round(pair[1]) }
}

/**
 * Pick the OpenAI-supported size closest to the requested box.
 * @param width - requested width.
 * @param height - requested height.
 * @param model - model id, which selects the supported family.
 * @returns the size string the endpoint accepts.
 */
function snapOpenAISize(width, height, model) {
  if (typeof model === 'string' && model.startsWith('dall-e-3')) {
    const ratio = width / height
    if (ratio > 1.2) return '1792x1024'
    if (ratio < 0.83) return '1024x1792'
    return '1024x1024'
  }
  const target = width / height
  let best = OPENAI_SIZES[0]
  let bestDelta = Infinity
  for (const size of OPENAI_SIZES) {
    const [w, h] = size.split('x').map(Number)
    const delta = Math.abs(w / h - target)
    if (delta < bestDelta) { bestDelta = delta; best = size }
  }
  return best
}

/**
 * Infer the protocol from a provider route id or endpoint host.
 * @param provider - provider route id stored in the Models settings.
 * @param baseURL - the profile's endpoint when it declares one.
 * @returns one protocol id.
 */
export function inferProtocol(provider, baseURL) {
  const haystack = `${provider ?? ''} ${baseURL ?? ''}`.toLowerCase()
  if (/gemini|generativelanguage|googleapis|google|vertex|imagen/.test(haystack)) return 'gemini'
  if (/ark|volces|seedream|doubao/.test(haystack)) return 'ark'
  if (/dashscope|aliyun|wanx|qwen-image/.test(haystack)) return 'dashscope'
  if (/openai|azure|deepseek|xai|groq|together|siliconflow|openrouter/.test(haystack)) return 'openai-compat'
  return 'openai'
}

/**
 * Trim a base URL and its trailing slashes.
 * @param value - configured endpoint.
 * @param fallback - endpoint used when the profile declares none.
 * @returns the normalized base URL.
 */
function baseOf(value, fallback) {
  const raw = typeof value === 'string' && value.length > 0 ? value : fallback
  return raw.replace(/\/+$/, '')
}

/**
 * Decode a base64 payload into bytes.
 * @param b64 - base64 text, with or without a data URL prefix.
 * @returns the decoded bytes.
 */
export function b64ToBytes(b64) {
  const clean = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64
  return new Uint8Array(Buffer.from(clean, 'base64'))
}

/** JSON request with timeout and bounded retry on throttling or upstream faults. */
export async function requestJson(url, init, options = {}) {
  const timeoutMs = options.timeoutMs ?? 180000
  const maxRetries = options.maxRetries ?? 3
  let wait = 1000
  let lastError
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const relay = () => controller.abort()
    options.signal?.addEventListener('abort', relay, { once: true })
    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      if (response.status === 429 || response.status >= 500) {
        const text = await response.text()
        lastError = new Error(`HTTP ${response.status}: ${text.slice(0, 400)}`)
        if (attempt === maxRetries) throw lastError
        await new Promise((done) => setTimeout(done, wait))
        wait = Math.min(wait * 2, 8000)
        continue
      }
      const text = await response.text()
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 600)}`)
      try {
        return JSON.parse(text)
      } catch {
        throw new Error(`expected JSON, received: ${text.slice(0, 200)}`)
      }
    } catch (error) {
      lastError = error
      if (attempt === maxRetries) throw error
      const status = /HTTP (4\d\d)/.exec(String(error?.message ?? ''))
      if (status && status[1] !== '429') throw error
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener?.('abort', relay)
    }
  }
  throw lastError ?? new Error('request failed')
}

/** Download one image URL into bytes. */
async function download(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`download HTTP ${response.status}`)
    const mime = (response.headers.get('content-type') ?? 'image/png').split(';')[0].trim()
    return { bytes: new Uint8Array(await response.arrayBuffer()), mime }
  } finally {
    clearTimeout(timer)
  }
}

/** Collect every image payload from a normalized vendor response body. */
async function collectImages(body, timeoutMs) {
  const items = []
  const push = (entry) => { if (entry !== undefined) items.push(entry) }
  const dataBlocks = Array.isArray(body?.data) ? body.data : []
  const imageBlocks = Array.isArray(body?.images) ? body.images : []
  const predictionBlocks = Array.isArray(body?.predictions) ? body.predictions : []
  for (const item of [...dataBlocks, ...imageBlocks, ...predictionBlocks]) {
    if (typeof item === 'string') { push(await download(item, timeoutMs)); continue }
    if (item === null || typeof item !== 'object') continue
    if (typeof item.b64_json === 'string') { push({ bytes: b64ToBytes(item.b64_json), mime: 'image/png' }); continue }
    if (typeof item.bytesBase64Encoded === 'string') {
      push({ bytes: b64ToBytes(item.bytesBase64Encoded), mime: item.mimeType ?? 'image/png' }); continue
    }
    if (typeof item.image === 'string' && item.image.length > 256) {
      push({ bytes: b64ToBytes(item.image), mime: 'image/png' }); continue
    }
    if (typeof item.url === 'string') { push(await download(item.url, timeoutMs)); continue }
  }
  if (typeof body?.image === 'string' && body.image.length > 256) {
    push({ bytes: b64ToBytes(body.image), mime: 'image/png' })
  }
  return items
}

/** Read one reference image into base64 and its mime type. */
async function readReference(ref) {
  if (typeof ref !== 'string' || ref.length === 0) return undefined
  if (ref.startsWith('data:')) {
    const mime = /^data:([^;]+)/.exec(ref)?.[1] ?? 'image/png'
    return { b64: ref.slice(ref.indexOf(',') + 1), mime, dataURL: ref }
  }
  const { readFile } = await import('node:fs/promises')
  const bytes = await readFile(ref)
  const ext = ref.toLowerCase().endsWith('.jpg') || ref.toLowerCase().endsWith('.jpeg') ? 'jpeg' : 'png'
  const b64 = bytes.toString('base64')
  return { b64, mime: `image/${ext}`, dataURL: `data:image/${ext};base64,${b64}` }
}

/**
 * OpenAI Images protocol: one request, base64 or URL back.
 * Covers the official endpoint, Azure, and every OpenAI-shaped gateway.
 */
async function openaiProtocol(request) {
  const { profile, model, prompt, count, seed, quality, outputFormat } = request
  const base = baseOf(profile.baseURL, 'https://api.openai.com/v1')
  const size = snapOpenAISize(request.width, request.height, model)
  const isAzure = /openai\.azure\.com/.test(base)

  if (request.references.length > 0) {
    const form = new FormData()
    form.append('model', model)
    form.append('prompt', prompt)
    form.append('n', String(count))
    form.append('size', size)
    for (const [index, ref] of request.references.entries()) {
      const read = await readReference(ref)
      if (read === undefined) continue
      form.append('image', new Blob([Buffer.from(read.b64, 'base64')], { type: read.mime }), `ref-${index}.png`)
    }
    const url = isAzure
      ? `${base}/images/edits?api-version=${profile.apiVersion ?? '2025-04-01-preview'}`
      : `${base}/images/edits`
    const headers = isAzure ? { 'api-key': profile.apiKey } : { Authorization: `Bearer ${profile.apiKey}` }
    const body = await requestJson(url, { method: 'POST', headers, body: form }, request.transport)
    return { body, images: await collectImages(body, request.transport.timeoutMs) }
  }

  const payload = {
    model,
    prompt,
    n: count,
    size,
    output_format: outputFormat,
  }
  if (quality !== undefined) payload.quality = quality
  if (seed !== undefined) payload.seed = seed
  if (typeof model === 'string' && !model.startsWith('gpt-image')) payload.response_format = 'b64_json'

  const url = isAzure
    ? `${base}/images/generations?api-version=${profile.apiVersion ?? '2025-04-01-preview'}`
    : `${base}/images/generations`
  const headers = isAzure
    ? { 'api-key': profile.apiKey, 'Content-Type': 'application/json' }
    : { Authorization: `Bearer ${profile.apiKey}`, 'Content-Type': 'application/json' }
  const body = await requestJson(url, { method: 'POST', headers, body: JSON.stringify(payload) }, request.transport)
  return { body, images: await collectImages(body, request.transport.timeoutMs) }
}

/** Google Gemini protocol: generateContent with inline image parts. */
async function geminiProtocol(request) {
  const { profile, model, prompt } = request
  const base = baseOf(profile.baseURL, 'https://generativelanguage.googleapis.com/v1beta')
  const parts = []
  for (const ref of request.references) {
    const read = await readReference(ref)
    if (read === undefined) continue
    parts.push({ inline_data: { mime_type: read.mime, data: read.b64 } })
  }
  if (request.negativePrompt) parts.push({ text: `${prompt}\n\nAvoid: ${request.negativePrompt}` })
  else parts.push({ text: prompt })

  const payload = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: snapAspect(GEMINI_ASPECTS, request.aspect), imageSize: request.resolution },
    },
  }
  const body = await requestJson(
    `${base}/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': profile.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    request.transport,
  )
  const images = []
  for (const candidate of body?.candidates ?? []) {
    for (const part of candidate?.content?.parts ?? []) {
      const inline = part?.inlineData ?? part?.inline_data
      if (typeof inline?.data === 'string') {
        images.push({ bytes: b64ToBytes(inline.data), mime: inline.mimeType ?? inline.mime_type ?? 'image/png' })
      }
    }
  }
  return { body, images }
}

/** Volcengine Ark Seedream protocol: one request, URL back, reference images inline. */
async function arkProtocol(request) {
  const { profile, model, prompt, count, seed } = request
  const base = baseOf(profile.baseURL, 'https://ark.cn-beijing.volces.com/api/v3')
  const payload = {
    model,
    prompt,
    size: `${request.width}x${request.height}`,
    response_format: 'url',
    watermark: false,
    sequential_image_generation: count > 1 ? 'auto' : 'disabled',
  }
  if (seed !== undefined) payload.seed = seed
  if (request.negativePrompt) payload.negative_prompt = request.negativePrompt
  if (request.references.length > 0) {
    const urls = []
    for (const ref of request.references) {
      const read = await readReference(ref)
      if (read !== undefined) urls.push(read.dataURL)
    }
    payload.image = urls
  }
  const body = await requestJson(
    `${base}/images/generations`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${profile.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    request.transport,
  )
  return { body, images: await collectImages(body, request.transport.timeoutMs) }
}

/** DashScope protocol through the OpenAI-compatible surface, URL back. */
async function dashscopeProtocol(request) {
  const { profile, model, prompt, count } = request
  const base = baseOf(profile.baseURL, 'https://dashscope.aliyuncs.com/compatible-mode/v1')
  const payload = {
    model,
    prompt,
    n: count,
    size: `${request.width}x${request.height}`,
    response_format: 'url',
  }
  if (request.negativePrompt) payload.negative_prompt = request.negativePrompt
  const body = await requestJson(
    `${base}/images/generations`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${profile.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    { ...request.transport, timeoutMs: 300000 },
  )
  return { body, images: await collectImages(body, request.transport.timeoutMs) }
}

const ADAPTERS = {
  openai: openaiProtocol,
  'openai-compat': openaiProtocol,
  gemini: geminiProtocol,
  ark: arkProtocol,
  dashscope: dashscopeProtocol,
}

/**
 * Run one generation against the resolved protocol adapter.
 * @param request - normalized generation request built by the Host route.
 * @returns the images, the resolved protocol, and the vendor body.
 */
export async function runProtocol(request) {
  const protocol = request.protocol === 'auto'
    ? inferProtocol(request.provider, request.profile.baseURL)
    : request.protocol
  const adapter = ADAPTERS[protocol] ?? openaiProtocol
  const outcome = await adapter({ ...request, protocol })
  return { ...outcome, protocol }
}

/** File extension for one mime type. */
export function extensionOf(mime) {
  return MIME_EXT[mime] ?? 'png'
}

/**
 * Read the real pixel size out of an encoded image, without decoding it.
 * The only reliable way to learn what a gateway actually produced: many
 * relays ignore the requested size and return the model's fixed tier.
 * @param bytes - the encoded image bytes.
 * @returns the width and height, or undefined when the container is unknown.
 */
export function readImageSize(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 32) return undefined

  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let cursor = 2
    while (cursor + 9 < bytes.length) {
      if (bytes[cursor] !== 0xff) { cursor += 1; continue }
      const marker = bytes[cursor + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { cursor += 2; continue }
      const length = (bytes[cursor + 2] << 8) | bytes[cursor + 3]
      const isFrame = marker >= 0xc0 && marker <= 0xcf
        && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isFrame) {
        return {
          width: (bytes[cursor + 7] << 8) | bytes[cursor + 8],
          height: (bytes[cursor + 5] << 8) | bytes[cursor + 6],
        }
      }
      cursor += 2 + length
    }
    return undefined
  }

  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const tag = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
    if (tag === 'VP8X') {
      return {
        width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
        height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)),
      }
    }
    if (tag === 'VP8 ') {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
    }
    if (tag === 'VP8L') {
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
  }

  return undefined
}
