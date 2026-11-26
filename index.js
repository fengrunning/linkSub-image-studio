/**
 * Image studio: a sidebar page plus an agent tool that turn text or reference
 * images into generated pictures through the model routes the user configured
 * under Settings → Models.
 *
 * The Host owns every credentialed call and every byte written to disk; the
 * browser page only submits parameters and renders the returned URLs.
 */

import { mkdir, readFile, writeFile, stat, appendFile } from 'node:fs/promises'
import { join, resolve, extname, sep } from 'node:path'
import { createHash } from 'node:crypto'

import {
  EDIT_CAPABLE, PROTOCOLS, PROTOCOL_LABELS, RATIOS, RESOLUTIONS,
  download, extensionOf, inferProtocol, parseAspect, readImageSize, requestJson, resolveSize, runProtocol,
} from './lib/generate.js'
import { capabilitiesFor, filterRequest } from './lib/capabilities.js'

/** Public route prefix served by the Host web server. */
const API_PREFIX = '/api/image-gen'

/** File extensions the file route serves. */
const SERVED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp'])

/** Service names this plugin requires; the model runtime is read optionally. */
export const inject = ['webServer', 'tools']

/**
 * Read the optional services this plugin uses through `ctx.get`, so a profile
 * without the model runtime still activates the page and reports an empty list.
 * @param ctx - host context.
 * @returns the three optional service handles.
 */
function services(ctx) {
  return {
    llm: ctx.get('llm'),
    settings: ctx.get('settings'),
    credentials: ctx.get('credentials'),
  }
}

/** Read a dotted path out of a settings value. */
function getPath(root, path) {
  let cursor = root
  for (const segment of path ?? []) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = cursor[segment]
  }
  return cursor
}

/** Own-property test for the ratio and resolution tables. */
function owns(table, key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key)
}

/**
 * Accept any `a:b` ratio the page sends, normalized to one colon form.
 * @param value - requested ratio, either a preset key or free text.
 * @returns the ratio to store and report.
 */
function normalizeAspect(value) {
  if (typeof value !== 'string') return '1:1'
  if (owns(RATIOS, value)) return value
  const pair = parseAspect(value)
  return pair === undefined ? '1:1' : `${pair[0]}:${pair[1]}`
}

/** Read the request body as text with a size ceiling. */
function readBody(req, limit = 64 * 1024 * 1024) {
  return new Promise((accept, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) { reject(new Error('request body too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => { accept(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}

/** Write one JSON reply. */
function sendJson(res, status, value) {
  const text = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(text)
}

/** Write one plain-text failure reply. */
function sendError(res, status, message, detail) {
  sendJson(res, status, { ok: false, error: { message, detail: detail ?? null } })
}

/** Pick the credential value out of a resolved credential record. */
function credentialValue(resolved) {
  if (resolved === undefined || resolved === null) return undefined
  for (const key of ['value', 'secret', 'apiKey', 'token']) {
    const found = resolved[key]
    if (typeof found === 'string' && found.length > 0) return found
  }
  return undefined
}

/** Recognize the routes that serve image models, by id, endpoint, or model name. */
function looksLikeImageProvider(providerId, baseURL, models) {
  const text = [providerId, baseURL ?? '', ...models.map((row) => row.id)].join(' ').toLowerCase()
  return /image|imagen|dall-?e|flux|stable-?diffusion|sdxl|\bsd[0-9x]|midjourney|grok-image|nano-banana|seedream|wanx|kolors|cogview|-t2i\b|t2i|文生图|超分|原生/.test(text)
}

/** Merge model rows from the adapter catalog and the stored profile. */
function mergeModels(listed, declared) {
  const seen = new Map()
  for (const entry of Array.isArray(listed) ? listed : []) {
    const id = typeof entry?.id === 'string' ? entry.id : undefined
    if (id === undefined) continue
    seen.set(id, { id, name: typeof entry.name === 'string' ? entry.name : id })
  }
  for (const entry of Array.isArray(declared) ? declared : []) {
    const id = typeof entry === 'string' ? entry : typeof entry?.id === 'string' ? entry.id : undefined
    if (id === undefined) continue
    const name = typeof entry === 'object' && typeof entry?.name === 'string' ? entry.name : id
    if (!seen.has(id)) seen.set(id, { id, name })
  }
  return [...seen.values()]
}

/**
 * Build the model catalog shown by the page.
 * Reads the provider directory the Models settings page maintains, each
 * provider's stored profile, and the credential state behind it.
 */
async function buildCatalog(ctx, config) {
  const { llm, settings, credentials } = services(ctx)
  const directory = typeof llm?.listConfigurableProviders === 'function'
    ? llm.listConfigurableProviders()
    : []
  const descriptors = typeof settings?.describe === 'function'
    ? settings.describe({ redactSecrets: true })
    : []
  const byName = new Map(descriptors.map((row) => [row.ns, row]))
  const providers = []

  for (const entry of directory) {
    const descriptor = byName.get(entry.settingsNs)
    const profile = getPath(descriptor?.value, entry.settingsPath) ?? {}
    const baseURL = typeof profile.baseURL === 'string'
      ? profile.baseURL
      : typeof profile.baseUrl === 'string' ? profile.baseUrl : undefined
    let listed = []
    try {
      listed = typeof llm?.listModels === 'function' ? await llm.listModels(entry.provider) : []
    } catch { listed = [] }
    const models = mergeModels(listed, profile.models)
      .map((row) => ({ ...row, capabilities: capabilitiesFor(row.id) }))
    let hasKey = false
    if (typeof profile.apiKeyEnv === 'string' && typeof credentials?.resolve === 'function') {
      try { hasKey = credentialValue(await credentials.resolve(profile.apiKeyEnv)) !== undefined } catch { hasKey = false }
    }
    if (!hasKey && typeof credentials?.describe === 'function' && typeof profile.apiKeyEnv === 'string') {
      try {
        const info = await credentials.describe(profile.apiKeyEnv)
        hasKey = info !== undefined && info !== null && Object.keys(info).length > 0
      } catch { hasKey = false }
    }
    providers.push({
      id: entry.provider,
      name: entry.displayName ?? entry.provider,
      settingsNs: entry.settingsNs,
      settingsPath: [...(entry.settingsPath ?? [])],
      baseURL: baseURL ?? null,
      hasKey,
      declared: entry.declared === true,
      error: entry.error ?? null,
      protocol: inferProtocol(entry.provider, baseURL),
      imageHint: looksLikeImageProvider(entry.provider, baseURL, models),
      models,
    })
  }

  providers.sort((a, b) => {
    if (a.imageHint !== b.imageHint) return a.imageHint ? -1 : 1
    if (a.hasKey !== b.hasKey) return a.hasKey ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return {
    ok: true,
    providers,
    protocols: PROTOCOLS.map((id) => ({ id, label: PROTOCOL_LABELS[id] })),
    ratios: Object.keys(RATIOS),
    resolutions: Object.keys(RESOLUTIONS),
    editCapable: EDIT_CAPABLE,
    outputDir: config.outputDir,
  }
}

/** Resolve one provider's live profile plus its credential literal. */
async function resolveProvider(ctx, catalog, providerId) {
  const { settings, credentials } = services(ctx)
  const entry = catalog.providers.find((row) => row.id === providerId)
  if (entry === undefined) throw new Error(`provider ${providerId} is not configured in Settings → Models`)
  const descriptor = typeof settings?.describe === 'function'
    ? settings.describe({ redactSecrets: true }).find((row) => row.ns === entry.settingsNs)
    : undefined
  const profile = { ...(getPath(descriptor?.value, entry.settingsPath) ?? {}) }
  if (typeof profile.baseURL !== 'string' && typeof entry.baseURL === 'string') profile.baseURL = entry.baseURL
  const ref = typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : undefined
  let apiKey
  if (ref !== undefined && typeof credentials?.resolve === 'function') {
    try { apiKey = credentialValue(await credentials.resolve(ref)) } catch { apiKey = undefined }
  }
  if (apiKey === undefined) {
    const envName = `${providerId.toUpperCase().replace(/[^A-Z0-9]+/gu, '_')}_API_KEY`
    apiKey = process.env[envName]
  }
  if (typeof apiKey !== 'string' || apiKey.length === 0) throw new Error(`provider ${providerId} has no API key in Settings → Models`)
  return { ...profile, apiKey }
}

/** Persist one generation record and its images. */
async function persist(root, record, images) {
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  const dir = resolve(root, day)
  await mkdir(dir, { recursive: true })
  const saved = []
  for (const [index, image] of images.entries()) {
    const name = `${record.id}-${index}.${extensionOf(image.mime)}`
    const file = join(dir, name)
    await writeFile(file, image.bytes)
    const actual = readImageSize(image.bytes)
    saved.push({
      file,
      name: `${day}/${name}`,
      mime: image.mime,
      url: `${API_PREFIX}/file?name=${encodeURIComponent(`${day}/${name}`)}`,
      bytes: image.bytes.length,
      actualWidth: actual?.width ?? null,
      actualHeight: actual?.height ?? null,
    })
  }
  return saved
}

/**
 * Append one record to the durable history file.
 *
 * The cap applies per conversation, not globally: one chatty conversation must
 * not push every other conversation out of the picker.
 * @param root - output directory holding `history.json`.
 * @param record - the record to store, newest first afterwards.
 * @param keep - records to retain per conversation.
 * @returns the retained records.
 */
async function appendHistory(root, record, keep) {
  const file = resolve(root, 'history.json')
  let existing = []
  try {
    const text = await readFile(file, 'utf8')
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) existing = parsed
  } catch { existing = [] }
  existing.unshift(record)
  const used = new Map()
  const kept = []
  for (const row of existing) {
    const owner = typeof row.thread === 'string' && row.thread.length > 0 ? row.thread : 'main'
    const count = used.get(owner) ?? 0
    if (count >= keep) continue
    used.set(owner, count + 1)
    kept.push(row)
  }
  await mkdir(resolve(root), { recursive: true })
  await writeFile(file, JSON.stringify(kept, null, 2))
  return kept
}

/** Short readable name for a conversation, taken from its first prompt. */
function threadTitle(prompt) {
  const text = typeof prompt === 'string' ? prompt.replace(/\s+/gu, ' ').trim() : ''
  return text.length === 0 ? '未命名会话' : text.slice(0, 24)
}

/**
 * Read the durable history file, optionally restricted to one conversation.
 * @param root - output directory holding `history.json`.
 * @param limit - newest entries to return.
 * @param thread - conversation id, or undefined for every entry.
 * @returns the matching records, newest first.
 */
async function readHistory(root, limit, thread) {
  const file = resolve(root, 'history.json')
  let rows
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    rows = Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
  const filtered = typeof thread === 'string' && thread.length > 0
    ? rows.filter((row) => (typeof row.thread === 'string' && row.thread.length > 0 ? row.thread : 'main') === thread)
    : rows
  return filtered.slice(0, limit)
}

/**
 * Archive one conversation out of the history file.
 *
 * The records leave `history.json` so the conversation stops appearing in the
 * picker, while every image already written stays where it is on disk: this is
 * an archive, not a shredder.
 * @param root - output directory holding `history.json`.
 * @param id - conversation to drop.
 * @returns how many records were removed.
 */
async function deleteThread(root, id) {
  const file = resolve(root, 'history.json')
  let rows = []
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    rows = Array.isArray(parsed) ? parsed : []
  } catch {
    rows = []
  }
  const kept = rows.filter((row) => {
    const owner = typeof row.thread === 'string' && row.thread.length > 0 ? row.thread : 'main'
    return owner !== id
  })
  await mkdir(resolve(root), { recursive: true })
  await writeFile(file, JSON.stringify(kept, null, 2))
  return rows.length - kept.length
}

/**
 * Summarize the conversations present in the history file.
 * @param root - output directory holding `history.json`.
 * @returns one summary per conversation, most recently updated first.
 */
async function readThreads(root) {
  const rows = await readHistory(root, Number.MAX_SAFE_INTEGER, undefined)
  const map = new Map()
  for (const row of rows) {
    const id = typeof row.thread === 'string' && row.thread.length > 0 ? row.thread : 'main'
    const image = Array.isArray(row.images) && row.images.length > 0 ? row.images[0].url : null
    const entry = map.get(id)
    if (entry === undefined) {
      map.set(id, {
        id,
        title: threadTitle(row.prompt),
        count: 1,
        createdAt: row.createdAt ?? null,
        updatedAt: row.createdAt ?? null,
        lastImage: image,
      })
      continue
    }
    entry.count += 1
    if (String(row.createdAt) > String(entry.updatedAt)) {
      entry.updatedAt = row.createdAt ?? entry.updatedAt
      entry.lastImage = image ?? entry.lastImage
    }
  }
  return [...map.values()].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
}

/**
 * Run one generation from a page or tool request.
 * @param ctx - host context carrying settings, credentials, and the model runtime.
 * @param config - resolved plugin configuration.
 * @param input - the request payload.
 * @returns the record describing the stored images.
 */
async function generate(ctx, config, input) {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
  if (prompt.length === 0) throw new Error('prompt is required')
  const catalog = await buildCatalog(ctx, config)
  const providerId = typeof input.provider === 'string' && input.provider.length > 0
    ? input.provider
    : catalog.providers.find((row) => row.hasKey)?.id
  if (providerId === undefined) throw new Error('no provider with a stored key found in Settings → Models')
  const providerEntry = catalog.providers.find((row) => row.id === providerId)
  const model = typeof input.model === 'string' && input.model.length > 0
    ? input.model
    : providerEntry?.models[0]?.id
  if (model === undefined) throw new Error(`provider ${providerId} lists no model`)
  const profile = await resolveProvider(ctx, catalog, providerId)

  const capabilities = capabilitiesFor(model)
  const filtered = filterRequest(input, capabilities)
  const size = resolveSize(filtered)
  const count = 1
  const protocol = typeof filtered.protocol === 'string' && PROTOCOLS.includes(filtered.protocol)
    ? filtered.protocol
    : 'auto'
  const references = Array.isArray(filtered.references)
    ? filtered.references.filter((row) => typeof row === 'string' && row.length > 0).slice(0, 4)
    : []
  const aspect = normalizeAspect(filtered.aspect)
  const resolution = owns(RESOLUTIONS, filtered.resolution) ? filtered.resolution : '1K'
  const started = Date.now()

  const outcome = await runProtocol({
    protocol,
    provider: providerId,
    profile,
    model,
    prompt,
    negativePrompt: typeof filtered.negativePrompt === 'string' && filtered.negativePrompt.trim().length > 0
      ? filtered.negativePrompt.trim() : undefined,
    width: size.width,
    height: size.height,
    aspect,
    resolution,
    count,
    seed: Number.isInteger(Number(filtered.seed)) && String(filtered.seed).length > 0 ? Number(filtered.seed) : undefined,
    quality: typeof filtered.quality === 'string' && filtered.quality.length > 0 ? filtered.quality : undefined,
    outputFormat: typeof filtered.outputFormat === 'string' && filtered.outputFormat.length > 0 ? filtered.outputFormat : 'png',
    references,
    transport: { timeoutMs: config.timeoutMs, maxRetries: config.maxRetries },
    signal: filtered.signal,
  })

  if (outcome.images.length === 0) {
    const reason = outcome.body?.error?.message ?? outcome.body?.message ?? 'the endpoint returned no image'
    throw new Error(`${outcome.protocol}: ${reason}`)
  }

  const id = createHash('sha256')
    .update(`${providerId}|${model}|${prompt}|${size.width}x${size.height}|${Date.now()}`)
    .digest('hex').slice(0, 20)
  const record = {
    id,
    thread: typeof input.thread === 'string' && input.thread.length > 0 ? input.thread : 'main',
    title: threadTitle(prompt),
    mode: references.length > 0 ? 'image-to-image' : 'text-to-image',
    protocol: outcome.protocol,
    provider: providerId,
    providerName: providerEntry?.name ?? providerId,
    model,
    family: capabilities.family,
    prompt,
    negativePrompt: typeof filtered.negativePrompt === 'string' ? filtered.negativePrompt : '',
    aspect,
    resolution,
    width: size.width,
    height: size.height,
    count,
    quality: typeof filtered.quality === 'string' ? filtered.quality : null,
    outputFormat: typeof filtered.outputFormat === 'string' ? filtered.outputFormat : 'png',
    seed: filtered.seed ?? null,
    referenceCount: references.length,
    elapsedMs: Date.now() - started,
    createdAt: new Date().toISOString(),
    images: [],
  }
  record.images = await persist(config.outputDir, record, outcome.images)
  await appendHistory(config.outputDir, record, config.historyLimit)
  return record
}

/**
 * Re-download upstream image URLs that a failed job already produced.
 *
 * Generation and transport are separate: a relay can hand back valid image URLs and still fail
 * because the CDN dropped the transfer. This path takes those URLs and finishes the job without
 * paying for another generation.
 * @param config - resolved plugin configuration.
 * @param input - `{ id?, urls, thread?, meta? }`; `meta` carries the original prompt/provider/model.
 * @returns `{ record, failures }` where failures lists URLs that still refused to download.
 */
export async function redownload(config, input) {
  const urls = (Array.isArray(input.urls) ? input.urls : [])
    .filter((row) => typeof row === 'string' && /^https?:\/\//i.test(row))
    .slice(0, 8)
  if (urls.length === 0) throw new Error('没有可重下的直链')
  const meta = input.meta !== null && typeof input.meta === 'object' ? input.meta : {}

  const images = []
  const failures = []
  for (const url of urls) {
    try {
      images.push(await download(url, config.timeoutMs))
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }
  if (images.length === 0) throw new Error(failures[0] ?? '图片下载失败')

  const id = createHash('sha256')
    .update(`${input.id ?? ''}|${urls[0]}|${Date.now()}`)
    .digest('hex').slice(0, 20)
  const prompt = typeof meta.prompt === 'string' && meta.prompt.length > 0 ? meta.prompt : '手动重下'
  const record = {
    id,
    thread: typeof input.thread === 'string' && input.thread.length > 0
      ? input.thread
      : (typeof meta.thread === 'string' && meta.thread.length > 0 ? meta.thread : 'main'),
    title: threadTitle(prompt),
    mode: typeof meta.mode === 'string' ? meta.mode : 'text-to-image',
    protocol: typeof meta.protocol === 'string' ? meta.protocol : 'manual',
    provider: typeof meta.provider === 'string' ? meta.provider : null,
    providerName: typeof meta.providerName === 'string' ? meta.providerName
      : (typeof meta.provider === 'string' ? meta.provider : null),
    model: typeof meta.model === 'string' ? meta.model : null,
    family: typeof meta.family === 'string' ? meta.family : null,
    prompt,
    negativePrompt: typeof meta.negativePrompt === 'string' ? meta.negativePrompt : '',
    aspect: typeof meta.aspect === 'string' ? meta.aspect : null,
    resolution: typeof meta.resolution === 'string' ? meta.resolution : null,
    width: Number(meta.width) > 0 ? Number(meta.width) : null,
    height: Number(meta.height) > 0 ? Number(meta.height) : null,
    count: images.length,
    quality: null,
    outputFormat: null,
    seed: null,
    referenceCount: 0,
    elapsedMs: 0,
    createdAt: new Date().toISOString(),
    retriedFrom: typeof input.id === 'string' ? input.id : null,
    recovered: true,
    images: [],
  }
  record.images = await persist(config.outputDir, record, images)
  await appendHistory(config.outputDir, record, config.historyLimit)
  return { record, failures }
}

/**
 * Look up a remembered failure by job id (survives a Host restart).
 * @param config - resolved plugin configuration.
 * @param id - job id from the page.
 * @returns the last matching `failed.jsonl` row, or undefined.
 */
async function findRemembered(config, id) {
  if (typeof id !== 'string' || id.length === 0) return undefined
  let text = ''
  try {
    text = await readFile(resolve(config.outputDir, 'failed.jsonl'), 'utf8')
  } catch {
    return undefined
  }
  const lines = text.trim().split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].length === 0) continue
    try {
      const row = JSON.parse(lines[index])
      if (row?.id === id) return row
    } catch { /* 坏行跳过 */ }
  }
  return undefined
}

/** Failed-job records kept on disk before the oldest are dropped. */
const FAILED_LOG_LIMIT = 500

/**
 * Remember a failed job's upstream URLs so they survive a restart.
 *
 * The log is capped: a broken relay can fail hundreds of runs, and an unbounded
 * file would make the lookup at the end of every retry slower each time.
 * @param config - resolved plugin configuration.
 * @param entry - the summary to append.
 */
export async function rememberFailure(config, entry) {
  const file = resolve(config.outputDir, 'failed.jsonl')
  try {
    await mkdir(resolve(config.outputDir), { recursive: true })
    await appendFile(file, JSON.stringify(entry) + '\n')
    const text = await readFile(file, 'utf8')
    const lines = text.split('\n').filter((line) => line.trim().length > 0)
    if (lines.length > FAILED_LOG_LIMIT) {
      await writeFile(file, `${lines.slice(-FAILED_LOG_LIMIT).join('\n')}\n`)
    }
  } catch { /* a lost failure record must never break generation */ }
}


/**
 * Learn what one model actually accepts, in the only way a relay exposes it.
 *
 * There is no standard capabilities endpoint, so the probe combines the three
 * sources that do exist: the model directory (`supported_endpoint_types`), the
 * relay's own error text (captured verbatim), and the real pixel size read back
 * out of a produced image (the only way to see what a relay really renders).
 * @param ctx - host context.
 * @param config - resolved plugin configuration.
 * @param input - `{ provider, model, sizes }`, where `sizes` are the pixel
 *   boxes to try; an empty list keeps the probe free of charge.
 * @returns the probe report.
 */
async function probeModel(ctx, config, input) {
  const catalog = await buildCatalog(ctx, config)
  const providerId = typeof input.provider === 'string' && input.provider.length > 0
    ? input.provider
    : catalog.providers.find((row) => row.hasKey)?.id
  if (providerId === undefined) throw new Error('no provider with a stored key found in Settings → Models')
  const entry = catalog.providers.find((row) => row.id === providerId)
  const model = typeof input.model === 'string' && input.model.length > 0
    ? input.model
    : entry?.models[0]?.id
  if (model === undefined) throw new Error(`provider ${providerId} lists no model`)
  const profile = await resolveProvider(ctx, catalog, providerId)
  const base = String(profile.baseURL ?? entry.baseURL ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
  const headers = { Authorization: `Bearer ${profile.apiKey}` }

  const report = {
    provider: providerId,
    model,
    baseURL: base,
    protocol: inferProtocol(providerId, base),
    modelCount: null,
    endpointTypes: null,
    catalogEntry: null,
    catalogError: null,
    attempts: [],
    checkedAt: new Date().toISOString(),
  }

  try {
    const list = await requestJson(`${base}/models`, { headers }, { timeoutMs: 30000, maxRetries: 1 })
    const rows = Array.isArray(list?.data) ? list.data : Array.isArray(list) ? list : []
    const found = rows.find((row) => row?.id === model) ?? null
    report.catalogEntry = found
    report.endpointTypes = Array.isArray(found?.supported_endpoint_types) ? found.supported_endpoint_types : null
    report.modelCount = rows.length
  } catch (error) {
    report.catalogError = error instanceof Error ? error.message : String(error)
  }

  const sizes = Array.isArray(input.sizes)
    ? input.sizes.filter((row) => typeof row === 'string').slice(0, 6)
    : []

  for (const size of sizes) {
    const started = Date.now()
    const attempt = { size, status: null, ms: 0, actualWidth: null, actualHeight: null, bytes: 0, reported: null, error: null }
    try {
      const body = await requestJson(`${base}/images/generations`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: 'a single flat color swatch', n: 1, size }),
      }, { timeoutMs: config.timeoutMs, maxRetries: 0 })
      attempt.status = 200
      const first = Array.isArray(body?.data) ? body.data[0] : undefined
      let bytes
      if (typeof first?.b64_json === 'string') bytes = new Uint8Array(Buffer.from(first.b64_json, 'base64'))
      else if (typeof first?.url === 'string') {
        const response = await fetch(first.url)
        bytes = new Uint8Array(await response.arrayBuffer())
      }
      const dims = bytes === undefined ? undefined : readImageSize(bytes)
      attempt.actualWidth = dims?.width ?? null
      attempt.actualHeight = dims?.height ?? null
      attempt.bytes = bytes?.length ?? 0
      if (typeof first?.size === 'string') attempt.reported = first.size
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const match = /HTTP (\d{3})/.exec(message)
      attempt.status = match ? Number(match[1]) : 'ERR'
      attempt.error = message.slice(0, 400)
    }
    attempt.ms = Date.now() - started
    report.attempts.push(attempt)
  }

  return report
}

/**
 * Generation jobs that outlive their initiating request.
 *
 * A run is paid for the moment it starts, so it must not be tied to one HTTP
 * connection: the page answers with a job id at once, the run finishes in the
 * background, and the page polls for it. Navigating away, reloading, or closing
 * the tab leaves the run and its history entry intact.
 */
const jobs = new Map()

/**
 * Project one job onto the wire.
 * @param job - the in-memory job record.
 * @param withRecord - include the finished record.
 * @returns the job as the page reads it.
 */
function jobSummary(job, withRecord) {
  return {
    id: job.id,
    status: job.status,
    prompt: job.prompt,
    provider: job.provider,
    providerName: job.providerName,
    model: job.model,
    startedAt: job.startedAt,
    elapsedMs: (job.finishedAt ?? Date.now()) - job.startedAt,
    error: job.error,
    ...(Array.isArray(job.urls) && job.urls.length > 0 ? { urls: job.urls } : {}),
    ...(withRecord === true && job.record !== null
      ? {
        record: {
          ...job.record,
          // The absolute disk path stays on the Host; the page only needs the URL.
          images: job.record.images.map(({ file, ...rest }) => rest),
        },
      }
      : {}),
  }
}

/**
 * Start one background generation.
 * @param ctx - host context.
 * @param config - resolved plugin configuration.
 * @param input - the request payload.
 * @returns the job handle, already running.
 */
function startJob(ctx, config, input) {
  const id = createHash('sha256')
    .update(`${Date.now()}|${Math.random()}|${typeof input.prompt === 'string' ? input.prompt : ''}`)
    .digest('hex').slice(0, 16)
  const job = {
    id,
    status: 'running',
    prompt: typeof input.prompt === 'string' ? input.prompt : '',
    provider: typeof input.provider === 'string' ? input.provider : null,
    providerName: null,
    model: typeof input.model === 'string' ? input.model : null,
    thread: typeof input.thread === 'string' && input.thread.length > 0 ? input.thread : 'main',
    // 失败重下时用这些字段把记录补完整（参考图不存，只留张数）
    meta: {
      prompt: typeof input.prompt === 'string' ? input.prompt : '',
      provider: typeof input.provider === 'string' ? input.provider : null,
      providerName: null,
      model: typeof input.model === 'string' ? input.model : null,
      mode: Array.isArray(input.references) && input.references.length > 0 ? 'image-to-image' : 'text-to-image',
      protocol: typeof input.protocol === 'string' ? input.protocol : 'auto',
      aspect: typeof input.aspect === 'string' ? input.aspect : null,
      resolution: typeof input.resolution === 'string' ? input.resolution : null,
      width: Number(input.width) > 0 ? Number(input.width) : null,
      height: Number(input.height) > 0 ? Number(input.height) : null,
      negativePrompt: typeof input.negativePrompt === 'string' ? input.negativePrompt : '',
      thread: typeof input.thread === 'string' && input.thread.length > 0 ? input.thread : 'main',
    },
    startedAt: Date.now(),
    finishedAt: null,
    record: null,
    error: null,
  }
  jobs.set(id, job)
  void (async () => {
    try {
      const record = await generate(ctx, config, input)
      job.record = record
      job.provider = record.provider
      job.providerName = record.providerName
      job.model = record.model
      job.meta.provider = record.provider
      job.meta.providerName = record.providerName
      job.meta.model = record.model
      job.meta.family = record.family
      job.meta.protocol = record.protocol
      job.meta.aspect = record.aspect
      job.meta.resolution = record.resolution
      job.meta.width = record.width
      job.meta.height = record.height
      job.status = 'succeeded'
    } catch (error) {
      job.error = error instanceof Error ? error.message : String(error)
      // 图没下来时把原始直链留下来：既能在这个进程里手动重下，也落一份到 failed.jsonl 防止重启后丢
      if (Array.isArray(error?.urls) && error.urls.length > 0) {
        job.urls = error.urls
        rememberFailure(config, {
          id,
          at: new Date().toISOString(),
          error: job.error,
          urls: error.urls,
          thread: job.thread,
          meta: job.meta,
        })
      }
      job.status = 'failed'
    } finally {
      job.finishedAt = Date.now()
      const finished = [...jobs.values()].filter((row) => row.status !== 'running')
      for (const row of finished.slice(0, Math.max(0, finished.length - 50))) jobs.delete(row.id)
    }
  })()
  return job
}

/**
 * Mount the routes, the agent tool, and the sidebar page dependency.
 * @param ctx - host context.
 * @param config - raw Loader configuration for this row.
 */
export function apply(ctx, config) {
  const resolvedConfig = {
    outputDir: resolve(typeof config?.outputDir === 'string' ? config.outputDir : 'outputs/images'),
    timeoutMs: Number(config?.timeoutMs) > 0 ? Number(config.timeoutMs) : 180000,
    maxRetries: Number.isInteger(config?.maxRetries) ? Number(config.maxRetries) : 3,
    historyLimit: Number(config?.historyLimit) > 0 ? Number(config.historyLimit) : 200,
  }

  ctx.effect(() => {
    const route = ctx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const sub = url.pathname.slice(API_PREFIX.length) || '/'
        try {
          if (req.method === 'GET' && sub === '/catalog') {
            sendJson(res, 200, await buildCatalog(ctx, resolvedConfig))
            return
          }
          if (req.method === 'GET' && sub === '/history') {
            const limit = Math.min(Number(url.searchParams.get('limit') ?? 60) || 60, 200)
            const thread = url.searchParams.get('thread') ?? undefined
            sendJson(res, 200, {
              ok: true,
              items: await readHistory(resolvedConfig.outputDir, limit, thread),
            })
            return
          }
          if (req.method === 'GET' && sub === '/threads') {
            sendJson(res, 200, { ok: true, threads: await readThreads(resolvedConfig.outputDir) })
            return
          }
          if (req.method === 'POST' && sub === '/thread/delete') {
            const raw = await readBody(req)
            const input = JSON.parse(raw.length > 0 ? raw : '{}')
            const id = typeof input.id === 'string' ? input.id : ''
            if (id.length === 0) { sendError(res, 400, 'a conversation id is required'); return }
            const removed = await deleteThread(resolvedConfig.outputDir, id)
            sendJson(res, 200, { ok: true, removed })
            return
          }
          if (req.method === 'GET' && sub === '/file') {
            const name = url.searchParams.get('name') ?? ''
            const target = resolve(resolvedConfig.outputDir, name)
            const root = resolve(resolvedConfig.outputDir)
            if (!target.startsWith(root + sep) || !SERVED_EXT.has(extname(target).toLowerCase())) {
              sendError(res, 400, 'invalid file name')
              return
            }
            const info = await stat(target).catch(() => undefined)
            if (info === undefined || !info.isFile()) { sendError(res, 404, 'file not found'); return }
            const mime = extname(target).toLowerCase() === '.png' ? 'image/png'
              : extname(target).toLowerCase() === '.webp' ? 'image/webp' : 'image/jpeg'
            res.statusCode = 200
            res.setHeader('Content-Type', mime)
            res.setHeader('Cache-Control', 'max-age=31536000, immutable')
            res.end(await readFile(target))
            return
          }
          if (req.method === 'POST' && sub === '/generate') {
            const raw = await readBody(req)
            const input = JSON.parse(raw.length > 0 ? raw : '{}')
            // Answer at once and let the run finish outside this request, so a
            // page navigation never cancels a generation that is already paid for.
            const job = startJob(ctx, resolvedConfig, input)
            sendJson(res, 202, { ok: true, job: jobSummary(job) })
            return
          }
          if (req.method === 'GET' && sub === '/job') {
            const id = url.searchParams.get('id') ?? ''
            const job = jobs.get(id)
            if (job === undefined) { sendError(res, 404, `job ${id} is not known`); return }
            sendJson(res, 200, { ok: true, job: jobSummary(job, true) })
            return
          }
          if (req.method === 'GET' && sub === '/jobs') {
            const rows = [...jobs.values()]
              .sort((left, right) => right.startedAt - left.startedAt)
              .slice(0, 20)
              .map((job) => jobSummary(job))
            sendJson(res, 200, { ok: true, jobs: rows })
            return
          }
          if (req.method === 'POST' && sub === '/retry-download') {
            const raw = await readBody(req)
            const input = JSON.parse(raw.length > 0 ? raw : '{}')
            // The Host only ever downloads what it recorded itself: first the live
            // job, then the durable failure log. A URL supplied by the page is
            // ignored, so this route can never be pointed at an arbitrary address.
            let source
            const known = typeof input.id === 'string' ? jobs.get(input.id) : undefined
            if (known !== undefined && Array.isArray(known.urls) && known.urls.length > 0) {
              source = known
            } else {
              const remembered = await findRemembered(resolvedConfig, input.id)
              if (remembered !== undefined && Array.isArray(remembered.urls) && remembered.urls.length > 0) {
                source = remembered
              }
            }
            if (source === undefined) {
              sendError(res, 400, '这个任务没有留下可重下的直链')
              return
            }
            try {
              const out = await redownload(resolvedConfig, {
                id: input.id,
                urls: source.urls,
                thread: typeof input.thread === 'string' && input.thread.length > 0
                  ? input.thread
                  : source.thread,
                meta: source.meta,
              })
              sendJson(res, 200, { ok: true, record: out.record, failures: out.failures })
            } catch (error) {
              sendError(res, 502, error instanceof Error ? error.message : String(error))
            }
            return
          }
          if (req.method === 'POST' && sub === '/probe') {
            const raw = await readBody(req)
            const input = JSON.parse(raw.length > 0 ? raw : '{}')
            const report = await probeModel(ctx, resolvedConfig, input)
            sendJson(res, 200, { ok: true, probe: report })
            return
          }
          sendError(res, 404, `unknown route ${sub}`)
        } catch (error) {
          sendError(res, 400, error instanceof Error ? error.message : String(error),
            error instanceof Error ? error.stack?.slice(0, 2000) ?? null : null)
        }
      },
    })

    const tool = ctx.tools.register({
      name: 'image_generate',
      description: '按提示词生成图片并落盘，返回可直接引用的图片地址。支持文生图和图生图，模型取自设置里已配置的生图模型。',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '画面描述，含主体、风格、光线、构图' },
          provider: { type: 'string', description: 'provider 路由 id，省略则取第一个已配置密钥的 provider' },
          model: { type: 'string', description: '模型 id，省略则取该 provider 的第一个模型' },
          protocol: { type: 'string', enum: PROTOCOLS, description: '协议，auto 表示按 provider 端点推断' },
          mode: { type: 'string', enum: ['text-to-image', 'image-to-image'], description: '省略时由参考图数量决定' },
          aspect: { type: 'string', description: '画面比例，如 16:9、9:16、1:1，也可以写任意 a:b' },
          resolution: { type: 'string', enum: Object.keys(RESOLUTIONS), description: '长边档位，默认 1K' },
          width: { type: 'integer', description: '像素宽，覆盖比例换算' },
          height: { type: 'integer', description: '像素高，覆盖比例换算' },
          seed: { type: 'integer', description: '随机种子' },
          quality: { type: 'string', description: 'OpenAI 质量档：low / medium / high' },
          outputFormat: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: '输出格式' },
          negativePrompt: { type: 'string', description: '排除的内容' },
          references: { type: 'array', items: { type: 'string' }, description: '参考图：本地绝对路径或 data URL，最多 4 张' },
        },
        required: ['prompt'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            protocol: { type: 'string' },
            provider: { type: 'string' },
            model: { type: 'string' },
            mode: { type: 'string' },
            width: { type: 'integer' },
            height: { type: 'integer' },
            images: { type: 'array', items: { type: 'object' } },
          },
        },
        render(_args, value) {
          const lines = [
            `${value.provider}/${value.model} · ${value.protocol} · ${value.mode} · ${value.width}x${value.height}`,
            ...(value.images ?? []).map((image) => `![生成结果](<${image.file}>)`),
          ]
          return [{ type: 'text', text: lines.join('\n\n') }]
        },
      },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const record = await generate(ctx, resolvedConfig, { ...args, signal: exec.signal })
        return {
          id: record.id,
          protocol: record.protocol,
          provider: record.provider,
          model: record.model,
          mode: record.mode,
          width: record.width,
          height: record.height,
          images: record.images,
        }
      },
    })

    return () => {
      tool()
      route()
    }
  }, 'image-gen: routes and tool')
}
