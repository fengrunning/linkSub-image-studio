/**
 * End-to-end self test for the LinkSub image studio plugin.
 *
 * Talks to the running Harness over HTTP exactly like the browser page does,
 * and checks both the happy paths and the failure paths that are easy to break
 * while refactoring.
 *
 *   node scripts/selftest.mjs [baseUrl]
 */

const BASE = process.argv[2] ?? 'http://127.0.0.1:3080/api/image-gen'

let passed = 0
let failed = 0
const failures = []

/**
 * Run one check.
 * @param name - what is being verified.
 * @param fn - async predicate; throw or return false to fail.
 */
async function check(name, fn) {
  try {
    const outcome = await fn()
    if (outcome === false) throw new Error('returned false')
    passed += 1
    console.log(`PASS  ${name}`)
  } catch (error) {
    failed += 1
    failures.push(`${name}: ${error.message}`)
    console.log(`FAIL  ${name}  →  ${error.message}`)
  }
}

/** GET returning parsed JSON plus the status code. */
async function get(path) {
  const response = await fetch(`${BASE}${path}`)
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = { _raw: text.slice(0, 200) } }
  return { status: response.status, body }
}

/** POST JSON returning parsed JSON plus the status code. */
async function post(path, payload) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  })
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = { _raw: text.slice(0, 200) } }
  return { status: response.status, body }
}

const RATIOS = ['1:1', '4:3', '3:2', '16:9', '9:16', '4:5', '3:4', '2:3', '21:9']

console.log(`base: ${BASE}\n`)

let catalog

await check('GET /catalog returns ok', async () => {
  const { status, body } = await get('/catalog')
  if (status !== 200) throw new Error(`status ${status}`)
  if (body.ok !== true) throw new Error(JSON.stringify(body).slice(0, 200))
  catalog = body
  return true
})

await check('catalog lists 9 ratios in the agreed order', () => {
  const got = (catalog?.ratios ?? []).join(' ')
  if (got !== RATIOS.join(' ')) throw new Error(`got "${got}"`)
  return true
})

await check('every image model carries a capability set', () => {
  const rows = (catalog?.providers ?? []).flatMap((p) => p.models ?? [])
  if (rows.length === 0) throw new Error('no models at all')
  const missing = rows.filter((row) => row.capabilities === undefined)
  if (missing.length > 0) throw new Error(`${missing.length} models without capabilities`)
  return true
})

await check('capabilities forbid seeds on grok-image', () => {
  const model = (catalog?.providers ?? [])
    .flatMap((p) => p.models ?? [])
    .find((row) => /grok-image/i.test(row.id))
  if (model === undefined) throw new Error('no grok-image model present')
  if (model.capabilities.seed !== false) throw new Error('seed is not disabled')
  if (model.capabilities.edit !== false) throw new Error('edit is not disabled')
  return true
})

await check('GET /threads answers a list', async () => {
  const { status, body } = await get('/threads')
  if (status !== 200) throw new Error(`status ${status}`)
  if (!Array.isArray(body.threads)) throw new Error('threads is not an array')
  return true
})

await check('GET /history scopes to one conversation', async () => {
  const { status, body } = await get('/history?limit=5&thread=main')
  if (status !== 200) throw new Error(`status ${status}`)
  if (!Array.isArray(body.items)) throw new Error('items is not an array')
  const wrong = body.items.filter((row) => (row.thread ?? 'main') !== 'main')
  if (wrong.length > 0) throw new Error(`${wrong.length} rows from another conversation leaked`)
  return true
})

await check('GET /history for an unknown conversation is empty', async () => {
  const { body } = await get('/history?thread=no-such-thread-xyz')
  if ((body.items ?? []).length !== 0) throw new Error('leaked rows')
  return true
})

await check('GET /file rejects a path traversal', async () => {
  const { status } = await get('/file?name=../../package.json')
  if (status === 200) throw new Error('traversal served a file')
  return true
})

await check('GET /file rejects a non-image extension', async () => {
  const { status } = await get('/file?name=history.json')
  if (status === 200) throw new Error('served a non-image file')
  return true
})

await check('GET /file reports a missing image', async () => {
  const { status } = await get('/file?name=20200101/nope.png')
  if (status === 200) throw new Error('served a missing file')
  return true
})

await check('GET /job on an unknown id is 404', async () => {
  const { status } = await get('/job?id=deadbeefdeadbeef')
  if (status !== 404) throw new Error(`status ${status}`)
  return true
})

await check('GET /jobs answers a list', async () => {
  const { status, body } = await get('/jobs')
  if (status !== 200) throw new Error(`status ${status}`)
  if (!Array.isArray(body.jobs)) throw new Error('jobs is not an array')
  return true
})

await check('POST /thread/delete on an unknown id removes nothing', async () => {
  const { status, body } = await post('/thread/delete', { id: 'nope-nope-nope' })
  if (status !== 200) throw new Error(`status ${status}`)
  if (body.removed !== 0) throw new Error(`removed ${body.removed}`)
  return true
})

await check('POST /thread/delete without an id is refused', async () => {
  const { status } = await post('/thread/delete', {})
  if (status === 200) throw new Error('accepted an empty id')
  return true
})

await check('POST /probe returns directory facts for free', async () => {
  const provider = (catalog?.providers ?? []).find((row) => row.imageHint && row.hasKey)
  if (provider === undefined) throw new Error('no image provider with a key')
  const { status, body } = await post('/probe', { provider: provider.id, model: provider.models[0].id })
  if (status !== 200) throw new Error(`status ${status}`)
  if (body.probe === undefined) throw new Error('no probe payload')
  if (body.probe.attempts.length !== 0) throw new Error('probe rendered images without being asked')
  return true
})

await check('POST /generate without a prompt answers 202 then fails the job', async () => {
  const { status, body } = await post('/generate', { provider: 'nope', prompt: '' })
  if (status !== 202) throw new Error(`status ${status}`)
  const id = body.job?.id
  if (typeof id !== 'string') throw new Error('no job id')
  let job
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    const polled = await get(`/job?id=${id}`)
    job = polled.body.job
    if (job !== undefined && job.status !== 'running') break
  }
  if (job === undefined) throw new Error('job never appeared')
  if (job.status !== 'failed') throw new Error(`status ${job.status}`)
  if (typeof job.error !== 'string' || job.error.length === 0) throw new Error('no error message')
  return true
})

await check('POST /generate with an unknown provider fails the job with a clear message', async () => {
  const { body } = await post('/generate', { provider: 'ghost-provider', prompt: 'a cat' })
  const id = body.job?.id
  if (typeof id !== 'string') throw new Error('no job id')
  let job
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    const polled = await get(`/job?id=${id}`)
    job = polled.body.job
    if (job !== undefined && job.status !== 'running') break
  }
  if (job?.status !== 'failed') throw new Error(`status ${job?.status}`)
  if (!/not configured|ghost-provider/i.test(String(job.error))) throw new Error(`unhelpful: ${job.error}`)
  return true
})

await check('unknown route answers 404', async () => {
  const { status } = await get('/nope')
  if (status !== 404) throw new Error(`status ${status}`)
  return true
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failures.length > 0) {
  console.log('\nfailures:')
  for (const row of failures) console.log(`  - ${row}`)
  process.exit(1)
}
