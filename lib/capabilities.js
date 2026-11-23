/**
 * What one image model actually accepts.
 *
 * Relays publish no capability document, so this module reads the model id
 * itself — the family (gpt-image, nano-banana, grok-image, seedream, flux, sd)
 * and the tier the name already encodes (`-4K`, `-1.5K`) — and returns the
 * parameter set that family honours. The page renders only these controls, and
 * the Host strips anything outside the set before it leaves the process.
 */

/** Ratios a Gemini-shaped model accepts as `aspectRatio`. */
const GEMINI_ASPECTS = ['1:1', '4:3', '3:2', '16:9', '9:16', '4:5', '3:4', '2:3', '21:9']

/** Ratios an OpenAI-shaped model can express through its three fixed boxes. */
const OPENAI_ASPECTS = ['1:1', '3:2', '2:3']

/** Ratios offered when a model takes an arbitrary width and height. */
const FREE_ASPECTS = ['1:1', '4:3', '3:2', '16:9', '9:16', '4:5', '3:4', '2:3', '21:9']

/** One tier token already written into a model id, such as `4K` or `1.5K`. */
const TIER = /(\d(?:\.\d)?)\s*k\b/iu

/** Family detection, most specific first. */
const FAMILIES = [
  { id: 'gpt-image', test: /gpt-image|dall-?e/iu },
  { id: 'nano-banana', test: /nano-banana|gemini[^ ]*image|imagen/iu },
  { id: 'grok-image', test: /grok[^ ]*image/iu },
  { id: 'seedream', test: /seedream|doubao/iu },
  { id: 'wanx', test: /wanx|qwen-image|tongyi/iu },
  { id: 'flux', test: /flux/iu },
  { id: 'sd', test: /stable-diffusion|sdxl|kolors|\bsd[-_]?[0-9x]/iu },
]

/**
 * Normalize one tier token into a resolution key.
 * @param token - the captured digits, such as `4` or `1.5`.
 * @returns the resolution key, or undefined when it is not a known tier.
 */
function tierKey(token) {
  if (token === undefined || token === null) return undefined
  const value = String(token).replace(/\.0$/u, '')
  if (value === '1') return '1K'
  if (value === '1.5') return '1.5K'
  if (value === '2') return '2K'
  if (value === '4') return '4K'
  return undefined
}

/**
 * Describe what one model accepts.
 * @param model - model id as the provider lists it.
 * @returns the capability set the page and the Host both honour.
 */
export function capabilitiesFor(model) {
  const name = String(model ?? '').toLowerCase()
  const family = FAMILIES.find((row) => row.test.test(name))?.id ?? 'unknown'
  const tier = tierKey(TIER.exec(name)?.[1])

  const shared = {
    family,
    /** Resolution keys to offer; one entry means the model's own tier is fixed. */
    resolutions: ['1K', '1.5K', '2K', '4K'],
    /** Tier the model id pins, when it pins one. */
    fixedResolution: null,
    /** Ratios to offer in the picker. */
    aspects: FREE_ASPECTS,
    /** Whether a free `a:b` box is meaningful for this model. */
    allowCustomAspect: true,
    /** Fixed pixel boxes, when the model takes only a closed set. */
    sizes: null,
    seed: true,
    negativePrompt: true,
    quality: false,
    outputFormat: true,
    edit: false,
    maxCount: 4,
    notes: [],
  }

  if (family === 'gpt-image') {
    return {
      ...shared,
      resolutions: tier === '4K' ? ['1K', '1.5K', '2K', '4K'] : ['1K', '1.5K', '2K'],
      fixedResolution: tier ?? null,
      aspects: OPENAI_ASPECTS,
      allowCustomAspect: false,
      sizes: ['1024x1024', '1536x1024', '1024x1536'],
      seed: false,
      negativePrompt: false,
      quality: true,
      edit: true,
      maxCount: 4,
      notes: ['固定三档画幅', '不吃种子', '不吃负面词'],
    }
  }

  if (family === 'nano-banana') {
    const tiers = tier === '4K' || /pro/iu.test(name) ? ['1K', '2K', '4K'] : ['1K', '2K']
    return {
      ...shared,
      resolutions: tiers,
      fixedResolution: tier ?? null,
      aspects: GEMINI_ASPECTS,
      allowCustomAspect: false,
      seed: false,
      negativePrompt: false,
      quality: false,
      outputFormat: false,
      edit: true,
      maxCount: 1,
      notes: ['比例走 aspectRatio 枚举', '不吃种子', '单次一张'],
    }
  }

  if (family === 'grok-image') {
    return {
      ...shared,
      resolutions: tier === undefined ? ['1K', '2K'] : [tier],
      fixedResolution: tier ?? null,
      seed: false,
      negativePrompt: false,
      quality: false,
      edit: false,
      maxCount: 4,
      notes: tier === undefined
        ? ['不吃种子', '不吃负面词', '档位由模型名决定']
        : [`固定 ${tier}`, '不吃种子', '不吃负面词'],
    }
  }

  if (family === 'seedream') {
    return {
      ...shared,
      resolutions: ['1K', '2K', '4K'],
      fixedResolution: tier ?? null,
      negativePrompt: false,
      quality: false,
      edit: true,
      maxCount: 4,
      notes: ['尺寸可用 1K/2K/4K', '不吃负面词'],
    }
  }

  if (family === 'wanx') {
    return {
      ...shared,
      resolutions: ['1K', '2K'],
      fixedResolution: tier ?? null,
      aspects: OPENAI_ASPECTS,
      allowCustomAspect: false,
      quality: false,
      edit: false,
      maxCount: 4,
      notes: ['尺寸走固定枚举'],
    }
  }

  if (family === 'sd') {
    return {
      ...shared,
      resolutions: ['1K'],
      fixedResolution: tier ?? null,
      quality: false,
      edit: true,
      notes: ['支持任意宽高与种子'],
    }
  }

  if (family === 'flux') {
    return {
      ...shared,
      resolutions: ['1K', '1.5K', '2K'],
      fixedResolution: tier ?? null,
      quality: false,
      edit: false,
      notes: ['支持任意宽高与种子'],
    }
  }

  return {
    ...shared,
    fixedResolution: tier ?? null,
    notes: ['未识别模型族，参数全部放开'],
  }
}

/** Pixel long edge of each resolution tier, for nearest-tier matching. */
const TIER_PIXELS = { '1K': 1024, '1.5K': 1536, '2K': 2048, '4K': 4096 }

/**
 * Pick the accepted ratio closest in value to the requested one.
 * @param list - accepted ratio strings.
 * @param value - the requested ratio text.
 * @returns the nearest accepted ratio.
 */
function nearestAspect(list, value) {
  const match = /^\s*(\d+(?:\.\d+)?)\s*[:：/]\s*(\d+(?:\.\d+)?)\s*$/u.exec(String(value ?? ''))
  if (match === null) return list[0]
  const target = Number(match[1]) / Number(match[2])
  if (!Number.isFinite(target) || target <= 0) return list[0]
  let best = list[0]
  let delta = Infinity
  for (const item of list) {
    const [width, height] = item.split(':').map(Number)
    const distance = Math.abs(width / height - target)
    if (distance < delta) { delta = distance; best = item }
  }
  return best
}

/**
 * Pick the accepted resolution tier closest to the requested one.
 * @param list - accepted resolution keys.
 * @param value - the requested key.
 * @returns the nearest accepted key.
 */
function nearestTier(list, value) {
  const target = TIER_PIXELS[value] ?? 1024
  let best = list[0]
  let delta = Infinity
  for (const item of list) {
    const distance = Math.abs((TIER_PIXELS[item] ?? 1024) - target)
    if (distance < delta) { delta = distance; best = item }
  }
  return best
}

/**
 * Drop everything the model does not accept, so an unsupported field never
 * reaches the vendor. A requested value outside the model's set is snapped to
 * the nearest accepted one instead of being reset to the first entry.
 * @param input - the raw request from the page or the agent tool.
 * @param capabilities - the model's capability set.
 * @returns a filtered request.
 */
export function filterRequest(input, capabilities) {
  const out = { ...input }
  // One image per run: the page carries no count control.
  out.count = 1
  if (!capabilities.seed) out.seed = undefined
  if (!capabilities.edit) out.references = []
  if (!capabilities.negativePrompt) out.negativePrompt = undefined
  if (!capabilities.quality) out.quality = undefined
  if (!capabilities.outputFormat) out.outputFormat = undefined

  if (!capabilities.allowCustomAspect && !capabilities.aspects.includes(String(input.aspect ?? ''))) {
    out.aspect = nearestAspect(capabilities.aspects, input.aspect)
  }

  const locked = capabilities.fixedResolution ?? null
  if (locked !== null) out.resolution = locked
  else if (capabilities.resolutions.length === 1) out.resolution = capabilities.resolutions[0]
  else if (!capabilities.resolutions.includes(input.resolution)) {
    out.resolution = nearestTier(capabilities.resolutions, input.resolution)
  }

  return out
}
