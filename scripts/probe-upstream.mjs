/**
 * Standalone capability probe for one OpenAI-shaped relay.
 *
 * Runs without the Harness: it reads the credential reference out of the local
 * credential file, asks the relay what it discloses about the model, then
 * renders one swatch and reports the real pixel box that came back.
 *
 *   node scripts/probe-upstream.mjs <provider-id> <model-id> [size]
 *
 * The size argument is optional; when omitted the probe renders nothing and
 * reports the directory entry alone, which costs no credit.
 *
 * Paths resolve from the environment so the same script works on any machine:
 *   DSH_HOME            default ~/.dsh
 *   DSH_PROFILE         default web
 *   DSH_PROFILE_DIR     overrides the profile directory
 *   DSH_CREDENTIAL_FILE overrides the credential file location
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readImageSize } from '../lib/generate.js'

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? '.'
const DSH_HOME = process.env.DSH_HOME ?? join(HOME, '.dsh')
const CREDENTIAL_FILE = process.env.DSH_CREDENTIAL_FILE ?? join(DSH_HOME, '.credentials.yaml')
const PROFILE_DIR = process.env.DSH_PROFILE_DIR
  ?? join(DSH_HOME, 'profiles', process.env.DSH_PROFILE ?? 'web')
const SETTINGS_FILE = join(PROFILE_DIR, 'cordis.patch.yml')

/**
 * Read one credential literal out of the flat YAML map the local credentials
 * service writes.
 * @param name - credential reference name.
 * @returns the literal, or undefined when the reference is absent.
 */
function credential(name) {
  let text
  try { text = readFileSync(CREDENTIAL_FILE, 'utf8') } catch { return undefined }
  for (const line of text.split(/\r?\n/u)) {
    const match = /^\s*([A-Za-z0-9_.-]+)\s*:\s*(.+)$/u.exec(line)
    if (match !== null && match[1] === name) {
      return match[2].trim().replace(/^["']|["']$/gu, '')
    }
  }
  return undefined
}

/**
 * Read a provider's baseURL and credential reference out of the profile patch.
 * @param provider - provider route id.
 * @returns the endpoint and the credential reference.
 */
function profile(provider) {
  let text
  try { text = readFileSync(SETTINGS_FILE, 'utf8') } catch { return {} }
  const lines = text.split(/\r?\n/u)
  let inside = false
  let baseURL
  let apiKeyEnv
  for (const line of lines) {
    const head = /^ {6}([A-Za-z0-9_.-]+):\s*$/u.exec(line)
    if (head !== null) { inside = head[1] === provider; continue }
    if (!inside) continue
    const field = /^ {8}([A-Za-z]+):\s*(.+)$/u.exec(line)
    if (field === null) continue
    if (field[1] === 'baseURL') baseURL = field[2].trim()
    if (field[1] === 'apiKeyEnv') apiKeyEnv = field[2].trim()
  }
  return { baseURL, apiKeyEnv }
}

const provider = process.argv[2]
const model = process.argv[3]
if (provider === undefined || model === undefined) {
  console.log('usage: node scripts/probe-upstream.mjs <provider-id> <model-id> [size]')
  console.log(`credential file: ${CREDENTIAL_FILE}`)
  console.log(`profile patch  : ${SETTINGS_FILE}`)
  process.exit(2)
}
const size = process.argv[4]

const found = profile(provider)
const base = String(found.baseURL ?? 'https://api.openai.com/v1').replace(/\/+$/u, '')
const key = found.apiKeyEnv === undefined ? undefined : credential(found.apiKeyEnv)
if (key === undefined) {
  console.log(JSON.stringify({ error: `no credential for ${provider} in ${CREDENTIAL_FILE}` }))
  process.exit(1)
}

const headers = { Authorization: `Bearer ${key}` }
console.log(JSON.stringify({ provider, model, baseURL: base, keyLength: key.length }))

try {
  const list = await (await fetch(`${base}/models`, { headers })).json()
  const rows = Array.isArray(list?.data) ? list.data : Array.isArray(list) ? list : []
  const entry = rows.find((row) => row?.id === model) ?? null
  console.log(JSON.stringify({ step: 'models', count: rows.length, entry }, null, 2))
} catch (error) {
  console.log(JSON.stringify({ step: 'models', error: String(error.message) }))
}

if (size !== undefined) {
  const started = Date.now()
  const response = await fetch(`${base}/images/generations`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: 'a single flat color swatch', n: 1, size }),
  })
  const text = await response.text()
  if (!response.ok) {
    console.log(JSON.stringify({ step: 'generate', size, status: response.status, body: text.slice(0, 600) }))
  } else {
    let body
    try { body = JSON.parse(text) } catch { body = undefined }
    const first = Array.isArray(body?.data) ? body.data[0] : undefined
    let bytes
    if (typeof first?.b64_json === 'string') bytes = new Uint8Array(Buffer.from(first.b64_json, 'base64'))
    else if (typeof first?.url === 'string') {
      bytes = new Uint8Array(await (await fetch(first.url)).arrayBuffer())
    }
    const dims = bytes === undefined ? undefined : readImageSize(bytes)
    console.log(JSON.stringify({
      step: 'generate',
      size,
      status: response.status,
      reportedSize: first?.size ?? null,
      urlLength: typeof first?.url === 'string' ? first.url.length : 0,
      bytes: bytes?.length ?? 0,
      actual: dims ?? null,
      elapsedMs: Date.now() - started,
    }, null, 2))
  }
}
