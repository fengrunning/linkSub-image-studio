// 失败任务的「手动重下」：不重新生成，只把上游直链下到磁盘并写进历史
// 用法: node scripts/retry-download-test.mjs
import HTTP from 'node:http'
import FS from 'node:fs'
import PATH from 'node:path'
import OS from 'node:os'
import { redownload, rememberFailure } from '../index.js'

const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJQA/9k=',
  'base64',
)

let hits404 = 0
const server = HTTP.createServer((req, res) => {
  if (req.url === '/ok.jpg') { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(JPEG) }
  if (req.url === '/gone.jpg') { hits404++; res.writeHead(404); return res.end('gone') }
  res.writeHead(500); res.end('boom')
})
await new Promise((r) => server.listen(8898, '127.0.0.1', r))
const B = 'http://127.0.0.1:8898'

const root = FS.mkdtempSync(PATH.join(OS.tmpdir(), 'retry-dl-'))
const config = { outputDir: root, timeoutMs: 5000, maxRetries: 1, historyLimit: 10 }

let passed = 0, failed = 0
const check = async (name, fn) => {
  try { await fn(); passed++; console.log('PASS  ' + name) }
  catch (e) { failed++; console.log('FAIL  ' + name + '  →  ' + (e && e.message)) }
}

await check('一条好直链：落盘 + 写历史 + 标记来源', async () => {
  const out = await redownload(config, {
    id: 'job-abc',
    urls: [B + '/ok.jpg'],
    thread: 'main',
    meta: { prompt: 'unit test', provider: 'seedream5pro', model: 'm', aspect: '1:1', resolution: '1K', width: 1024, height: 1024 },
  })
  if (out.record.images.length !== 1) throw new Error('图片数 ' + out.record.images.length)
  const file = out.record.images[0].file
  if (!FS.existsSync(file)) throw new Error('文件没落盘: ' + file)
  if (FS.statSync(file).size !== JPEG.length) throw new Error('字节数不对')
  if (out.record.recovered !== true) throw new Error('没打 recovered 标记')
  if (out.record.retriedFrom !== 'job-abc') throw new Error('没记 retriedFrom')
  if (out.record.prompt !== 'unit test') throw new Error('提示词没带过来: ' + out.record.prompt)
  const hist = JSON.parse(FS.readFileSync(PATH.join(root, 'history.json'), 'utf8'))
  if (!hist.some((row) => row.id === out.record.id)) throw new Error('历史里没有这条')
})

await check('好一条坏一条：好的一样交付，坏的进 failures', async () => {
  const out = await redownload(config, { id: 'job-mix', urls: [B + '/ok.jpg', B + '/gone.jpg'] })
  if (out.record.images.length !== 1) throw new Error('应当 1 张，实得 ' + out.record.images.length)
  if (out.failures.length !== 1) throw new Error('failures 应为 1，实得 ' + out.failures.length)
  if (!/404/.test(out.failures[0])) throw new Error('失败文案不对: ' + out.failures[0])
})

await check('全坏：抛错并带原因', async () => {
  try {
    await redownload(config, { id: 'job-bad', urls: [B + '/gone.jpg'] })
    throw new Error('应当抛错')
  } catch (e) {
    if (!/download HTTP 404/.test(e.message)) throw new Error('文案不对: ' + e.message)
  }
})

await check('没带直链：拒绝并且不写历史', async () => {
  const before = JSON.parse(FS.readFileSync(PATH.join(root, 'history.json'), 'utf8')).length
  try {
    await redownload(config, { id: 'job-empty', urls: [] })
    throw new Error('应当抛错')
  } catch (e) {
    if (!/没有可重下的直链/.test(e.message)) throw new Error('文案不对: ' + e.message)
  }
  const after = JSON.parse(FS.readFileSync(PATH.join(root, 'history.json'), 'utf8')).length
  if (after !== before) throw new Error('不该写历史')
})

await check('失败记录落 failed.jsonl（重启后还能查）', async () => {
  rememberFailure(config, { id: 'job-abc', error: '图片下载失败（x）：ECONNRESET', urls: [B + '/ok.jpg'] })
  await new Promise((r) => setTimeout(r, 300))
  const file = PATH.join(root, 'failed.jsonl')
  if (!FS.existsSync(file)) throw new Error('failed.jsonl 没生成')
  const lines = FS.readFileSync(file, 'utf8').trim().split('\n')
  const row = JSON.parse(lines[lines.length - 1])
  if (row.id !== 'job-abc' || !Array.isArray(row.urls) || row.urls.length !== 1) {
    throw new Error('内容不对: ' + lines[lines.length - 1])
  }
})

server.close()
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
