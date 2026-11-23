/**
 * Protocol adapter test against a local mock upstream.
 *
 * The live relay answers 502 right now, so the success path has to be proven
 * without it: this spins up a tiny HTTP server that answers in each vendor's
 * shape and drives the real adapters through `runProtocol`.
 *
 *   node scripts/adapter-test.mjs
 */

import { createServer } from 'node:http'
import { readImageSize, runProtocol } from '../lib/generate.js'
import { capabilitiesFor, filterRequest } from '../lib/capabilities.js'

/** A 1×1 transparent PNG, base64 encoded. */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let passed = 0
let failed = 0

/**
 * Run one check.
 * @param name - what is verified.
 * @param fn - async predicate; throw to fail.
 */
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS  ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL  ${name}  →  ${error.message}`)
  }
}

/** Collect a request body as text. */
function bodyOf(req) {
  return new Promise((accept) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => accept(Buffer.concat(chunks).toString('utf8')))
  })
}

const seen = []
const server = createServer(async (req, res) => {
  const path = req.url ?? '/'
  const body = await bodyOf(req)
  seen.push({ path, body })

  if (path.startsWith('/v1/images/generations')) {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ created: 1, data: [{ b64_json: PNG_B64 }] }))
    return
  }
  if (path.startsWith('/img')) {
    res.setHeader('Content-Type', 'image/png')
    res.end(Buffer.from(PNG_B64, 'base64'))
    return
  }
  if (path.includes(':generateContent')) {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({
      candidates: [{
        content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }] },
        finishReason: 'STOP',
      }],
    }))
    return
  }
  if (path.startsWith('/ark/images/generations')) {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ data: [{ url: `${base}/img/one.png`, size: '1024x1024' }] }))
    return
  }
  res.statusCode = 404
  res.end('{}')
})

await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve) })
const port = server.address().port
const base = `http://127.0.0.1:${port}`

const transport = { timeoutMs: 15000, maxRetries: 0 }

await check('openai adapter decodes b64_json', async () => {
  const out = await runProtocol({
    protocol: 'openai',
    provider: 'mock',
    profile: { baseURL: `${base}/v1`, apiKey: 'k' },
    model: 'gpt-image-2.5-1.5K',
    prompt: 'a cat',
    width: 1024,
    height: 1024,
    aspect: '1:1',
    resolution: '1K',
    count: 1,
    outputFormat: 'png',
    references: [],
    transport,
  })
  if (out.images.length !== 1) throw new Error(`images ${out.images.length}`)
  const size = readImageSize(out.images[0].bytes)
  if (size?.width !== 1 || size?.height !== 1) throw new Error(`size ${JSON.stringify(size)}`)
})

await check('openai adapter snaps a square request to a legal box', async () => {
  const last = seen.filter((row) => row.path.startsWith('/v1/images/generations')).at(-1)
  const payload = JSON.parse(last.body)
  if (payload.size !== '1024x1024') throw new Error(`sent size ${payload.size}`)
  if ('seed' in payload) throw new Error('sent a seed to a gpt-image model')
  if ('response_format' in payload) throw new Error('sent response_format to a gpt-image model')
})

await check('openai adapter snaps a 16:9 request to 1536x1024', async () => {
  await runProtocol({
    protocol: 'openai',
    provider: 'mock',
    profile: { baseURL: `${base}/v1`, apiKey: 'k' },
    model: 'gpt-image-2.5-1.5K',
    prompt: 'a cat',
    width: 1024,
    height: 576,
    aspect: '16:9',
    resolution: '1K',
    count: 1,
    outputFormat: 'png',
    references: [],
    transport,
  })
  const last = seen.filter((row) => row.path.startsWith('/v1/images/generations')).at(-1)
  const payload = JSON.parse(last.body)
  if (payload.size !== '1536x1024') throw new Error(`sent size ${payload.size}`)
})

await check('ark adapter downloads the returned url', async () => {
  const out = await runProtocol({
    protocol: 'ark',
    provider: 'mock',
    profile: { baseURL: `${base}/ark`, apiKey: 'k' },
    model: 'doubao-seedream-4-0',
    prompt: 'a cat',
    width: 2048,
    height: 2048,
    aspect: '1:1',
    resolution: '2K',
    count: 1,
    outputFormat: 'png',
    references: [],
    transport,
  })
  if (out.images.length !== 1) throw new Error(`images ${out.images.length}`)
  if (out.images[0].bytes.length === 0) throw new Error('empty bytes')
})

await check('ark adapter sends image[] for references and a seed', async () => {
  await runProtocol({
    protocol: 'ark',
    provider: 'mock',
    profile: { baseURL: `${base}/ark`, apiKey: 'k' },
    model: 'doubao-seedream-4-0',
    prompt: 'a cat',
    width: 1024,
    height: 1024,
    aspect: '1:1',
    resolution: '1K',
    count: 1,
    seed: 42,
    outputFormat: 'png',
    references: [`data:image/png;base64,${PNG_B64}`],
    transport,
  })
  const last = seen.filter((row) => row.path.startsWith('/ark/images/generations')).at(-1)
  const payload = JSON.parse(last.body)
  if (!Array.isArray(payload.image) || payload.image.length !== 1) throw new Error('no image array')
  if (payload.seed !== 42) throw new Error(`seed ${payload.seed}`)
  if (payload.sequential_image_generation !== 'disabled') throw new Error('count not applied')
})

await check('gemini adapter reads inlineData parts', async () => {
  const out = await runProtocol({
    protocol: 'gemini',
    provider: 'mock',
    profile: { baseURL: `${base}/v1beta`, apiKey: 'k' },
    model: 'Nano-banana-Pro',
    prompt: 'a cat',
    width: 1024,
    height: 576,
    aspect: '16:9',
    resolution: '1K',
    count: 1,
    outputFormat: 'png',
    references: [],
    transport,
  })
  if (out.images.length !== 1) throw new Error(`images ${out.images.length}`)
  if (out.images[0].mime !== 'image/png') throw new Error(`mime ${out.images[0].mime}`)
})

await check('gemini adapter sends a legal aspectRatio and an image key', async () => {
  const last = seen.filter((row) => row.path.includes(':generateContent')).at(-1)
  const payload = JSON.parse(last.body)
  const aspect = payload.generationConfig?.imageConfig?.aspectRatio
  if (!['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'].includes(aspect)) {
    throw new Error(`illegal aspectRatio ${aspect}`)
  }
  if (payload.generationConfig?.responseModalities?.[0] !== 'IMAGE') throw new Error('no IMAGE modality')
})

await check('an HTTP error surfaces as a thrown message', async () => {
  let threw = false
  try {
    await runProtocol({
      protocol: 'openai',
      provider: 'mock',
      profile: { baseURL: `${base}/nope`, apiKey: 'k' },
      model: 'gpt-image-2.5-1.5K',
      prompt: 'a cat',
      width: 1024,
      height: 1024,
      aspect: '1:1',
      resolution: '1K',
      count: 1,
      outputFormat: 'png',
      references: [],
      transport,
    })
  } catch { threw = true }
  if (!threw) throw new Error('no error raised')
})

await check('a non-edit model drops its references before the request', () => {
  const caps = capabilitiesFor('Grok-image-2.0-4K')
  const filtered = filterRequest({ prompt: 'x', references: ['a', 'b'], seed: 5 }, caps)
  if (filtered.references.length !== 0) throw new Error('references survived')
  if (filtered.seed !== undefined) throw new Error('seed survived')
})

server.close()
console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
