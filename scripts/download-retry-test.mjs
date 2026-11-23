// 图片下载层：重试 / 超时 / 报错文案 / 部分成功
// 用法: node scripts/download-retry-test.mjs
import HTTP from 'node:http'
import { download, collectImages } from '../lib/generate.js'

const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJQA/9k=',
  'base64',
)

let flakyHits = 0
let hits404 = 0
const server = HTTP.createServer((req, res) => {
  if (req.url === '/ok.jpg') {
    res.writeHead(200, { 'content-type': 'image/jpeg' })
    return res.end(JPEG)
  }
  if (req.url === '/flaky.jpg') {
    flakyHits++
    if (flakyHits <= 2) { req.socket.destroy(); return }
    res.writeHead(200, { 'content-type': 'image/jpeg' })
    return res.end(JPEG)
  }
  if (req.url === '/hang.jpg') { return }
  if (req.url === '/404.jpg') { hits404++; res.writeHead(404); return res.end('nope') }
  res.writeHead(500); res.end('boom')
})

let passed = 0, failed = 0
const check = async (name, fn) => {
  try { await fn(); passed++; console.log('PASS  ' + name) }
  catch (e) { failed++; console.log('FAIL  ' + name + '  →  ' + (e && e.message)) }
}

await new Promise((r) => server.listen(8899, '127.0.0.1', r))
const B = 'http://127.0.0.1:8899'

await check('正常图一次就下来', async () => {
  const out = await download(B + '/ok.jpg', 5000)
  if (out.bytes.length === 0) throw new Error('bytes 为空')
  if (out.mime !== 'image/jpeg') throw new Error('mime=' + out.mime)
})

await check('前两次连接被掐断，第三次成功（自动重试）', async () => {
  const out = await download(B + '/flaky.jpg', 5000)
  if (out.bytes.length === 0) throw new Error('bytes 为空')
  if (flakyHits < 3) throw new Error('只打了 ' + flakyHits + ' 次，没重试')
})

await check('404 立刻失败且只试 1 次', async () => {
  try {
    await download(B + '/404.jpg', 5000)
    throw new Error('应当失败却成功了')
  } catch (e) {
    if (!/download HTTP 404/.test(e.message)) throw new Error('文案不对：' + e.message)
    if (hits404 !== 1) throw new Error('打了 ' + hits404 + ' 次，4xx 不该重试')
  }
})

await check('地址不存在时给出主机名与原因', async () => {
  try {
    await download('http://127.0.0.1:1/none.jpg', 800)
    throw new Error('应当失败却成功了')
  } catch (e) {
    if (!/图片下载失败（127\.0\.0\.1:1）/.test(e.message)) throw new Error('文案不对：' + e.message)
    if (!/已尝试 \d 次/.test(e.message)) throw new Error('没写重试次数：' + e.message)
  }
})

await check('挂住不回时不无限等待', async () => {
  const t0 = Date.now()
  try {
    await download(B + '/hang.jpg', 400)
    throw new Error('应当超时失败')
  } catch (e) {
    const ms = Date.now() - t0
    if (!/timeout/i.test(e.message)) throw new Error('文案没有 timeout：' + e.message)
    if (ms > 20000) throw new Error('耗时过长 ' + ms + 'ms')
  }
})

await check('多图时坏一张不影响好的一张', async () => {
  const body = { data: [{ url: B + '/ok.jpg' }, { url: B + '/404.jpg' }] }
  const out = await collectImages(body, 5000)
  if (out.length !== 1) throw new Error('拿到 ' + out.length + ' 张，应当 1 张')
})

await check('全坏才抛错，并把直链带出来', async () => {
  const body = { data: [{ url: B + '/404.jpg' }] }
  try {
    await collectImages(body, 5000)
    throw new Error('应当抛错')
  } catch (e) {
    if (!/download HTTP 404/.test(e.message)) throw new Error('文案不对：' + e.message)
    if (!Array.isArray(e.urls) || e.urls.length !== 1) throw new Error('没带 e.urls')
  }
})

server.close()
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
