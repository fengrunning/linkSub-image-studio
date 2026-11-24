/**
 * Image studio, browser half: a sidebar entry plus the main-column page
 * it opens. The page reads like a conversation: results stream above, and one
 * composer at the bottom carries the prompt, the reference images, the model
 * picker, the size controls, and the generate action.
 *
 * Every credentialed call happens on the Host route; this module only submits
 * parameters and renders the returned image URLs.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-plugin-image-studio',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    /** Shared by the sidebar entry and the main panel it opens. */
    const PANEL_ID = 'image-studio'
    /** Sidebar position, between the skill manager at 6 and the account seat at 8. */
    const ENTRY_ORDER = 7
    /** Host route prefix owned by this plugin. */
    const API = '/api/image-gen'
    /** Dictionary namespace owned by this plugin. */
    const NS = 'imageStudio'

    const DICT = {
      zh: {
        panel: '生图工坊',
        title: '生图工坊',
        subtitle: '模型来自「设置 → 模型」里已添加的生图模型',
        imageModels: '生图模型',
        otherModels: '其它模型',
        model: '模型',
        prompt: '提示词',
        promptHint: '描述画面：主体、风格、光线、构图 · 可粘贴或拖入图片 · 回车生成',
        negative: '负面提示词',
        negativeHint: '不想出现的内容',
        reference: '参考图',
        addImage: '上传图片',
        clearImage: '清空参考图',
        ratio: '比例',
        resolution: '分辨率',
        count: '张数',
        advanced: '更多参数',
        collapse: '收起参数',
        seed: '种子',
        quality: '质量',
        format: '格式',
        protocol: '协议',
        size: '像素',
        customRatio: '自定义比例',
        probe: '探测能力',
        fixedByModel: '由模型决定',
        unsupported: '该模型不支持',
        modelCaps: '该模型',
        probeMeta: '查模型信息',
        probeSizes: '测尺寸 ×3',
        probing: '探测中',
        endpoints: '端点类型',
        requested: '请求',
        actual: '实际',
        status: '状态',
        noCatalog: '该中转没有披露模型元数据',
        catalogModels: '模型总数',
        generate: '生成',
        generating: '生成中',
        refresh: '刷新',
        reuse: '复用参数',
        open: '新窗口打开',
        emptyTitle: '还没有生成过图片',
        emptyBody: '在下面写好提示词，选好模型，点「生成」',
        elapsed: '耗时',
        noModel: '设置 → 模型 里还没有可用的模型',
        noKey: '缺密钥',
        autoProtocol: '自动推断',
        limitedEdit: '该模型不吃参考图，会按文生图处理',
        continueEdit: '继续修改',
        chain: '接上一张',
        chainOff: '独立生成',
        chainHint: '开启后，没粘图时自动用上一张结果当参考图',
        carry: '带原词',
        carryOff: '只发新词',
        carryHint: '接上一张时，把上一轮的提示词一起发过去',
        basedOnLast: '基于上一张',
        newThread: '新建会话',
        newThreadName: '新会话',
        deleteThread: '删除会话',
        deleteConfirm: '确认删除',
        deleteHint: '从列表移除该会话，已生成的图片仍留在磁盘上',
        thread: '会话',
        retryDownload: '手动重下',
        retrying: '重下中',
        copyLinks: '复制直链',
        copied: '已复制',
        retryHint: '图已经生成，只是没下下来；点这里直接重拉直链，不重新生成',
      },
      en: {
        panel: 'Image Studio',
        title: 'Image Studio',
        subtitle: 'Models come from what you added under Settings → Models',
        imageModels: 'Image models',
        otherModels: 'Other models',
        model: 'Model',
        prompt: 'Prompt',
        promptHint: 'Subject, style, light · Paste or drop an image · Enter sends',
        negative: 'Negative prompt',
        negativeHint: 'What to leave out',
        reference: 'References',
        addImage: 'Add image',
        clearImage: 'Clear references',
        ratio: 'Aspect',
        resolution: 'Resolution',
        count: 'Count',
        advanced: 'More options',
        collapse: 'Fewer options',
        seed: 'Seed',
        quality: 'Quality',
        format: 'Format',
        protocol: 'Protocol',
        size: 'Pixels',
        customRatio: 'Custom ratio',
        probe: 'Probe',
        fixedByModel: 'Set by the model',
        unsupported: 'unsupported',
        modelCaps: 'This model',
        probeMeta: 'Model info',
        probeSizes: 'Test sizes ×3',
        probing: 'Probing',
        endpoints: 'Endpoints',
        requested: 'asked',
        actual: 'got',
        status: 'status',
        noCatalog: 'This relay discloses no model metadata',
        catalogModels: 'Models listed',
        generate: 'Generate',
        generating: 'Generating',
        refresh: 'Refresh',
        reuse: 'Reuse',
        open: 'Open',
        emptyTitle: 'Nothing generated yet',
        emptyBody: 'Write a prompt below, pick a model, then press Generate',
        elapsed: 'elapsed',
        noModel: 'No model is configured under Settings → Models',
        noKey: 'no key',
        autoProtocol: 'Auto',
        limitedEdit: 'This model ignores references; it runs text to image',
        continueEdit: 'Keep editing',
        chain: 'Chain from last',
        chainOff: 'Standalone',
        chainHint: 'When on, the previous result becomes the reference if nothing is pasted',
        carry: 'Carry prompt',
        carryOff: 'New words only',
        carryHint: 'When chaining, send the previous prompt along with the new one',
        basedOnLast: 'from previous',
        newThread: 'New chat',
        newThreadName: 'New chat',
        deleteThread: 'Delete chat',
        deleteConfirm: 'Confirm delete',
        deleteHint: 'Removes the conversation from the list; generated files stay on disk',
        thread: 'Chat',
        retryDownload: 'Retry download',
        retrying: 'Downloading',
        copyLinks: 'Copy links',
        copied: 'Copied',
        retryHint: 'The image was generated but never arrived; pull the link again without paying for another run',
      },
    }

    /** Active copy table, chosen once from the browser language. */
    const LANG = String(typeof navigator === 'undefined' ? 'zh' : navigator.language ?? 'zh')
      .toLowerCase().startsWith('zh') ? 'zh' : 'en'
    const t = { text: (key) => (DICT[LANG] ?? DICT.zh)[key] ?? key }

    /**
     * Accept a free-form ratio typed by the user, half-width or full-width colon.
     * @param text - what sits in the custom-ratio box.
     * @returns the normalized `a:b` text, or undefined when it is not a ratio.
     */
    function parseRatio(text) {
      const match = /^\s*(\d+(?:\.\d+)?)\s*[:：/]\s*(\d+(?:\.\d+)?)\s*$/.exec(String(text ?? ''))
      if (match === null) return undefined
      const width = Number(match[1])
      const height = Number(match[2])
      return width > 0 && height > 0 ? `${width}:${height}` : undefined
    }

    /** Where the in-flight job id survives a page switch or a reload. */
    const JOB_KEY = 'dsh-image-studio-job'

    /** Whether the next run continues from the previous result. */
    const CHAIN_KEY = 'dsh-image-studio-chain'

    /** Whether a chained run resends the previous prompt. */
    const CARRY_KEY = 'dsh-image-studio-carry'

    /** Which conversation the page is showing. */
    const THREAD_KEY = 'dsh-image-studio-thread'

    /**
     * Read one served image back into a data URL, so a finished picture can be
     * handed to the next run as a reference image.
     * @param url - same-origin image URL.
     * @returns the data URL, or undefined when the read failed.
     */
    async function imageToDataURL(url) {
      try {
        const response = await fetch(url, { credentials: 'include' })
        if (!response.ok) return undefined
        const blob = await response.blob()
        return await new Promise((accept) => {
          const reader = new FileReader()
          reader.onload = () => { accept(String(reader.result)) }
          reader.onerror = () => { accept(undefined) }
          reader.readAsDataURL(blob)
        })
      } catch {
        return undefined
      }
    }

    /**
     * Poll one background job until it settles.
     * @param jobId - the job to follow.
     * @returns the finished record, or null when the job carries none.
     */
    async function awaitJob(jobId) {
      for (let attempt = 0; attempt < 400; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1200))
        let body
        try {
          const response = await fetch(`${API}/job?id=${encodeURIComponent(jobId)}`, { credentials: 'include' })
          body = await response.json()
        } catch {
          continue
        }
        if (!body.ok) throw new Error(body.error?.message ?? 'job lookup failed')
        if (body.job.status === 'succeeded') return body.job.record ?? null
        if (body.job.status === 'failed') {
          const failure = new Error(body.job.error ?? 'generation failed')
          // 上游已经把图烤出来了，只是没下下来：把直链带出去，页面可以手动重下
          if (Array.isArray(body.job.urls) && body.job.urls.length > 0) {
            failure.urls = body.job.urls
            failure.jobId = jobId
          }
          throw failure
        }
      }
      throw new Error(LANG === 'zh' ? '生成超时' : 'generation timed out')
    }

    /** Ratios the picker offers, in the user's preferred order. */
    const PRESET_RATIOS = ['1:1', '4:3', '3:2', '16:9', '9:16', '4:5', '3:4', '2:3', '21:9']

    /** Short use case shown beside each ratio in the picker. */
    const RATIO_LABELS = {
      '1:1': '正方形 · 头像帖子',
      '4:3': '传统相机 · PPT',
      '3:2': '单反画幅 · 6寸照',
      '16:9': '宽屏 · 视频封面',
      '9:16': '竖屏 · 短视频',
      '4:5': '竖版帖子 · 满屏',
      '3:4': '小红书竖图',
      '2:3': '海报 · 竖版摄影',
      '21:9': '超宽屏 · 电影感',
    }

    const controlStyle = {
      boxSizing: 'border-box', padding: '6px 9px',
      borderRadius: 8, fontSize: 12, fontFamily: 'inherit',
      color: 'var(--dsw-alias-label-primary)',
      background: 'var(--dsw-alias-bg-layer-1)',
      border: '1px solid var(--dsw-alias-border-l1)',
      outline: 'none',
    }

    /** One label above a composer control. */
    function Field(props) {
      return h('label', {
        style: {
          display: 'flex', flexDirection: 'column', gap: 5,
          fontSize: 11, color: 'var(--dsw-alias-label-secondary)',
        },
      }, h('span', null, props.label), props.children)
    }

    /** Quiet button used across the header and run rows. */
    function GhostButton(props) {
      return h('button', {
        type: 'button',
        onClick: props.onClick,
        disabled: props.disabled,
        title: props.title,
        style: {
          padding: '5px 10px', borderRadius: 8, fontSize: 12, fontFamily: 'inherit',
          cursor: props.disabled ? 'default' : 'pointer',
          color: 'var(--dsw-alias-label-primary)',
          background: 'transparent',
          border: '1px solid var(--dsw-alias-border-l1)',
          whiteSpace: 'nowrap',
          ...props.style,
        },
      }, props.children)
    }

    /** One generated image, click to open it full screen. */
    function ImageCard(props) {
      const image = props.image
      return h('figure', {
        style: {
          margin: 0, borderRadius: 12, overflow: 'hidden',
          border: '1px solid var(--dsw-alias-border-l1)',
          background: 'var(--dsw-alias-bg-layer-1)',
          display: 'flex', flexDirection: 'column',
          transition: 'box-shadow 140ms ease, transform 140ms ease',
        },
      },
        h('button', {
          type: 'button',
          onClick: props.onOpen,
          style: {
            display: 'block', padding: 0, border: 'none', background: 'transparent',
            cursor: 'zoom-in', lineHeight: 0,
          },
        },
          h('img', {
            src: image.url, alt: '', loading: 'lazy',
            style: { display: 'block', width: '100%', height: 'auto', maxHeight: 520, objectFit: 'contain' },
          })),
        h('figcaption', {
          style: {
            display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
            fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)',
            borderTop: '1px solid var(--dsw-alias-border-l1)',
          },
        },
          h('span', {
            style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
          }, image.actualWidth === null || image.actualWidth === undefined
            ? image.name
            : `${image.actualWidth}×${image.actualHeight}`),
          h('a', {
            href: image.url, target: '_blank', rel: 'noreferrer',
            style: { color: 'var(--dsw-alias-brand-primary)', textDecoration: 'none', flex: '0 0 auto' },
          }, props.openLabel)))
    }

    /**
     * Full-screen viewer with keyboard navigation.
     * @param props - `{ images, index, onClose, onStep }`.
     * @returns the overlay.
     */
    function Lightbox(props) {
      const images = props.images
      const index = props.index
      const close = props.onClose
      const step = props.onStep

      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') close()
          else if (event.key === 'ArrowRight') step(1)
          else if (event.key === 'ArrowLeft') step(-1)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [close, step])

      const image = images[index]
      if (image === undefined) return null

      const arrow = (direction, label, glyph) => h('button', {
        type: 'button',
        onClick: (event) => { event.stopPropagation(); step(direction) },
        title: label,
        style: {
          position: 'absolute', top: '50%', transform: 'translateY(-50%)',
          [direction > 0 ? 'right' : 'left']: 18,
          width: 40, height: 40, borderRadius: '50%', cursor: 'pointer',
          border: 'none', background: 'rgba(255,255,255,0.16)', color: '#fff',
          fontSize: 18, lineHeight: 1, fontFamily: 'inherit',
        },
      }, glyph)

      return h('div', {
        onClick: close,
        role: 'presentation',
        style: {
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.84)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 28, cursor: 'zoom-out',
        },
      },
        h('img', {
          src: image.url, alt: '',
          onClick: (event) => event.stopPropagation(),
          style: {
            maxWidth: '92vw', maxHeight: '86vh', objectFit: 'contain',
            borderRadius: 10, boxShadow: '0 16px 60px rgba(0,0,0,0.55)',
          },
        }),
        images.length > 1 ? arrow(-1, 'prev', '‹') : null,
        images.length > 1 ? arrow(1, 'next', '›') : null,
        h('div', {
          style: {
            position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
            fontSize: 11.5, color: 'rgba(255,255,255,0.72)',
            fontVariantNumeric: 'tabular-nums',
          },
        }, `${index + 1} / ${images.length}`))
    }

    /**
     * The report row a capability probe produces: what the relay discloses
     * about the model, and what it really renders for each requested size.
     * @param props - `{ probe }`.
     * @returns the report row.
     */
    function ProbeCard(props) {
      const probe = props.probe
      const attempts = Array.isArray(probe.attempts) ? probe.attempts : []
      const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }
      return h('div', {
        style: {
          display: 'flex', flexDirection: 'column', gap: 8,
          borderRadius: 12, padding: '11px 13px',
          background: 'var(--dsw-alias-bg-layer-1)',
          border: '1px solid var(--dsw-alias-border-l1)',
        },
      },
        h('div', {
          style: {
            display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap',
            fontSize: 11, color: 'var(--dsw-alias-label-secondary)',
          },
        },
          h('span', {
            style: { color: 'var(--dsw-alias-brand-primary)', fontWeight: 600, fontSize: 12 },
          }, `${t.text('probe')} · ${probe.provider}/${probe.model}`),
          h('span', null, probe.baseURL),
          h('span', null, probe.protocol),
          h('span', null, `${t.text('catalogModels')} ${probe.modelCount ?? '—'}`),
          h('span', null, `${t.text('endpoints')} ${probe.endpointTypes === null ? '—' : probe.endpointTypes.join(' / ')}`),
          probe.catalogError === null
            ? null
            : h('span', { style: { color: 'var(--dsw-alias-state-warn-primary)' } },
              String(probe.catalogError).slice(0, 160)),
          probe.catalogEntry === null && probe.catalogError === null
            ? h('span', { style: { color: 'var(--dsw-alias-state-warn-primary)' } }, t.text('noCatalog'))
            : null),
        attempts.length === 0
          ? h('div', {
            style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' },
          }, LANG === 'zh'
            ? '想测实际出图尺寸，点「测尺寸 ×3」，每一次都是真实调用'
            : 'Press "Test sizes ×3" to render three swatches; each call is real')
          : h('div', {
            style: { display: 'flex', flexDirection: 'column', gap: 4, ...mono, fontSize: 11.5 },
          }, attempts.map((attempt) => h('div', {
            key: attempt.size,
            style: { display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'baseline' },
          },
            h('span', { style: { minWidth: 96 } }, `${t.text('requested')} ${attempt.size}`),
            h('span', {
              style: {
                minWidth: 52,
                color: attempt.status === 200
                  ? 'var(--dsw-alias-state-success-primary)'
                  : 'var(--dsw-alias-state-error-primary)',
              },
            }, String(attempt.status)),
            h('span', { style: { minWidth: 118 } },
              attempt.actualWidth === null
                ? '—'
                : `${t.text('actual')} ${attempt.actualWidth}×${attempt.actualHeight}`),
            h('span', { style: { minWidth: 62 } }, `${attempt.ms}ms`),
            attempt.error === null
              ? null
              : h('span', {
                style: { flex: 1, color: 'var(--dsw-alias-state-error-primary)', wordBreak: 'break-word' },
              }, attempt.error.slice(0, 160))))))
    }

    /** One generated run, laid out as a conversation turn. */
    function RunRow(props) {
      const record = props.record
      if (record.kind === 'probe') return h(ProbeCard, { probe: record.probe })
      return h('div', {
        style: { display: 'flex', flexDirection: 'column', gap: 9 },
      },
        h('div', {
          style: {
            display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap',
            fontSize: 11, color: 'var(--dsw-alias-label-secondary)',
          },
        },
          h('span', {
            style: {
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '2px 9px', borderRadius: 999,
              color: 'var(--dsw-alias-brand-primary)',
              border: '1px solid var(--dsw-alias-border-l1)',
              background: 'var(--dsw-alias-bg-layer-1)',
            },
          }, `${record.providerName ?? record.provider}/${record.model}`),
          h('span', null, `${record.protocol} · ${record.mode}`),
          h('span', null, `${record.width}×${record.height}`),
          record.aspect === undefined ? null : h('span', null, record.aspect),
          record.seed === null || record.seed === undefined ? null : h('span', null, `seed ${record.seed}`),
          h('span', null, `${t.text('elapsed')} ${((record.elapsedMs ?? 0) / 1000).toFixed(1)}s`),
          h('span', { style: { flex: 1 } }),
          h(GhostButton, { onClick: () => props.onContinue(record) }, t.text('continueEdit')),
          h(GhostButton, { onClick: () => props.onReuse(record) }, t.text('reuse'))),
        h('div', {
          style: {
            padding: '9px 12px', borderRadius: 10,
            background: 'var(--dsw-alias-bg-layer-1)',
            border: '1px solid var(--dsw-alias-border-l1)',
            fontSize: 12.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          },
        }, record.prompt),
        h('div', {
          style: {
            display: 'grid', gap: 12,
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          },
        }, (record.images ?? []).map((image, index) => h(ImageCard, {
          key: index,
          image,
          openLabel: t.text('open'),
          onOpen: () => props.onOpen(record.images, index),
        }))))
    }

    /**
     * The prompt as a right-aligned message, shown the moment it is sent so the
     * text leaves the composer instead of waiting there for the result.
     * @param props - `{ record }`.
     * @returns the message bubble.
     */
    function UserBubble(props) {
      const record = props.record
      const meta = [record.providerName ?? record.provider, record.model, record.aspect, record.resolution]
        .filter((part) => typeof part === 'string' && part.length > 0)
        .join(' · ')
      return h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
        h('div', {
          style: {
            maxWidth: '78%', display: 'flex', flexDirection: 'column',
            gap: 5, alignItems: 'flex-end',
          },
        },
          h('div', {
            style: {
              padding: '9px 13px', borderRadius: '14px 14px 4px 14px',
              background: 'var(--dsw-alias-bg-layer-2)',
              border: '1px solid var(--dsw-alias-border-l1)',
              fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              color: 'var(--dsw-alias-label-primary)',
            },
          }, record.prompt),
          h('div', {
            style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' },
          }, meta)))
    }

    /**
     * The placeholder that occupies the result's seat while the run is running.
     * @param props - `{ startedAt }`.
     * @returns the pending card.
     */
    function PendingCard(props) {
      const seconds = Math.max(0, Math.floor((Date.now() - props.startedAt) / 1000))
      return h('div', {
        style: {
          borderRadius: 12, overflow: 'hidden',
          border: '1px solid var(--dsw-alias-border-l1)',
          background: 'var(--dsw-alias-bg-layer-1)',
          display: 'flex', flexDirection: 'column',
        },
      },
        h('div', {
          style: {
            height: 190,
            backgroundImage:
              'linear-gradient(100deg, transparent 18%, var(--dsw-alias-bg-layer-2) 46%, transparent 74%)',
            backgroundSize: '240% 100%',
            backgroundRepeat: 'no-repeat',
            animation: 'dsh-image-studio-shimmer 1.5s ease-in-out infinite',
          },
        }),
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 9,
            padding: '9px 12px', fontSize: 12,
            color: 'var(--dsw-alias-label-secondary)',
            borderTop: '1px solid var(--dsw-alias-border-l1)',
          },
        },
          h('span', {
            style: {
              width: 13, height: 13, borderRadius: '50%',
              border: '2px solid var(--dsw-alias-border-l2)',
              borderTopColor: 'var(--dsw-alias-brand-primary)',
              display: 'inline-block', animation: 'dsh-image-studio-spin 0.8s linear infinite',
            },
          }),
          h('span', null, `${t.text('generating')}…`),
          h('span', {
            style: { marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' },
          }, `${seconds}s`)))
    }

    /**
     * 上游出图了但没下下来的那张：给一条直链 + 一个「手动重下」。
     * @param props - `{ failed, retrying, onRetry, onCopy, copied }`.
     */
    function FailedCard(props) {
      const target = props.failed
      if (target === null) return null
      const count = Array.isArray(target.urls) ? target.urls.length : 0
      return h('div', {
        style: {
          borderRadius: 12, padding: '12px 14px',
          border: '1px dashed var(--dsw-alias-state-warn-primary)',
          background: 'var(--dsw-alias-bg-layer-1)',
          display: 'flex', flexDirection: 'column', gap: 9,
        },
      },
        h('div', {
          style: { fontSize: 12.5, lineHeight: 1.6, color: 'var(--dsw-alias-label-primary)' },
        }, `${t.text('retryHint')}（${count} 条直链）`),
        h('div', {
          style: {
            fontSize: 11, lineHeight: 1.5, maxHeight: 60, overflow: 'hidden',
            color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-all',
            fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
          },
        }, target.urls.join('\n')),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h(GhostButton, {
            onClick: () => props.onRetry(target),
            disabled: props.retrying,
          }, props.retrying ? `${t.text('retrying')}…` : t.text('retryDownload')),
          h(GhostButton, { onClick: () => props.onCopy(target.urls) },
            props.copied ? t.text('copied') : t.text('copyLinks'))))
    }

    /** The blank state shown before the first run. */
    function EmptyState() {
      return h('div', {
        style: {
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 12,
          minHeight: 260,
        },
      },
        h('div', {
          style: {
            width: 58, height: 58, borderRadius: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid var(--dsw-alias-border-l1)',
            background: 'var(--dsw-alias-bg-layer-1)',
            color: 'var(--dsw-alias-label-secondary)',
          },
        },
          h('svg', {
            width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none',
            stroke: 'currentColor', strokeWidth: 1.6,
            strokeLinecap: 'round', strokeLinejoin: 'round',
            'aria-hidden': true,
          },
            h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3 }),
            h('circle', { cx: 8.5, cy: 9.5, r: 1.5 }),
            h('path', { d: 'M4 17.5l4.6-4.2 3.2 2.9 2.6-2.4 5.6 5.2' }))),
        h('div', {
          style: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
        }, t.text('emptyTitle')),
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
          t.text('emptyBody')))
    }

    /** The initial form state. */
    const initialState = {
      protocol: 'auto',
      providerId: '',
      model: '',
      prompt: '',
      negativePrompt: '',
      aspect: '1:1',
      customAspect: '',
      resolution: '1K',
      count: 1,
      seed: '',
      quality: '',
      outputFormat: 'png',
      references: [],
    }

    /** The whole page: a scrolling run stream above one composer at the bottom. */
    function ImageStudioPage() {
      const [catalog, setCatalog] = useState(null)
      const [form, setForm] = useState(initialState)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      /** 上游已出图但没下下来的那次任务：{ id, urls, thread } */
      const [failed, setFailed] = useState(null)
      const [retrying, setRetrying] = useState(false)
      const [copied, setCopied] = useState(false)
      const [records, setRecords] = useState([])
      const [threadId, setThreadId] = useState(() => {
        try { return localStorage.getItem(THREAD_KEY) ?? 'main' } catch { return 'main' }
      })
      const [threads, setThreads] = useState([])
      const [confirmDelete, setConfirmDelete] = useState(false)
      const [viewer, setViewer] = useState(null)
      /** Which conversation the stream currently reflects. */
      const activeThreadRef = useRef(threadId)
      const [showAdvanced, setShowAdvanced] = useState(false)
      const [showNegative, setShowNegative] = useState(false)
      const [probing, setProbing] = useState(false)
      const [focused, setFocused] = useState(false)
      const [pending, setPending] = useState(null)
      const [chain, setChain] = useState(() => {
        try { return localStorage.getItem(CHAIN_KEY) !== 'off' } catch { return true }
      })
      const [carry, setCarry] = useState(() => {
        try { return localStorage.getItem(CARRY_KEY) === 'on' } catch { return false }
      })
      const [, setTick] = useState(0)
      const streamRef = useRef(null)
      const promptRef = useRef(null)

      const patch = useCallback((next) => { setForm((current) => ({ ...current, ...next })) }, [])

      /** Whether the stream should keep following new content. */
      const stickRef = useRef(true)

      const scrollToBottom = useCallback(() => {
        const node = streamRef.current
        if (node === null || !stickRef.current) return
        node.scrollTop = node.scrollHeight
      }, [])

      /** Follow only while the reader is already near the bottom. */
      const onStreamScroll = useCallback(() => {
        const node = streamRef.current
        if (node === null) return
        stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 90
      }, [])

      const loadCatalog = useCallback(async () => {
        setError(null)
        try {
          const response = await fetch(`${API}/catalog`, { credentials: 'include' })
          const body = await response.json()
          if (!body.ok) throw new Error(body.error?.message ?? 'catalog read failed')
          setCatalog(body)
          setForm((current) => {
            const provider = body.providers.find((row) => row.id === current.providerId)
              ?? body.providers.find((row) => row.hasKey && row.imageHint)
              ?? body.providers.find((row) => row.hasKey)
              ?? body.providers.find((row) => row.imageHint)
              ?? body.providers[0]
            const model = provider?.models.some((row) => row.id === current.model)
              ? current.model
              : provider?.models[0]?.id ?? ''
            return { ...current, providerId: provider?.id ?? '', model }
          })
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        }
      }, [])

      const loadThreads = useCallback(async () => {
        try {
          const response = await fetch(`${API}/threads`, { credentials: 'include' })
          const body = await response.json()
          if (body.ok) setThreads(Array.isArray(body.threads) ? body.threads : [])
        } catch { /* the list keeps what it has */ }
      }, [])

      const loadHistory = useCallback(async (thread) => {
        const target = typeof thread === 'string' && thread.length > 0 ? thread : 'main'
        try {
          const response = await fetch(
            `${API}/history?limit=60&thread=${encodeURIComponent(target)}`,
            { credentials: 'include' },
          )
          const body = await response.json()
          if (!body.ok) return
          if (target !== activeThreadRef.current) return
          const items = Array.isArray(body.items) ? [...body.items].reverse() : []
          setRecords(items)
          requestAnimationFrame(scrollToBottom)
        } catch { /* the stream keeps what it has */ }
      }, [scrollToBottom])

      useEffect(() => { void loadCatalog() }, [loadCatalog])
      useEffect(() => { void loadThreads() }, [loadThreads])
      useEffect(() => {
        activeThreadRef.current = threadId
        void loadHistory(threadId)
      }, [threadId, loadHistory])

      /**
       * Show another conversation. A run already in flight keeps going on the
       * Host; its result lands in its own conversation.
       * @param id - conversation to display.
       */
      const switchThread = useCallback((id) => {
        if (id === threadId) return
        try { localStorage.setItem(THREAD_KEY, id) } catch { /* the choice stays in memory */ }
        setRecords([])
        setPending(null)
        setBusy(false)
        setError(null)
        setThreadId(id)
      }, [threadId])

      /** Start a fresh conversation; it joins the list after its first image. */
      const newThread = useCallback(() => {
        const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
        try { localStorage.setItem(THREAD_KEY, id) } catch { /* the choice stays in memory */ }
        setRecords([])
        setPending(null)
        setBusy(false)
        setError(null)
        setThreadId(id)
        promptRef.current?.focus()
      }, [])

      /** Archive the current conversation out of the picker. */
      const archiveThread = useCallback(async () => {
        setConfirmDelete(false)
        try {
          const response = await fetch(`${API}/thread/delete`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: threadId }),
          })
          const body = await response.json()
          if (!body.ok) throw new Error(body.error?.message ?? 'delete failed')
          const remaining = threads.filter((row) => row.id !== threadId)
          const next = remaining.length > 0 ? remaining[0].id : 'main'
          try { localStorage.setItem(THREAD_KEY, next) } catch { /* the choice stays in memory */ }
          setRecords([])
          setPending(null)
          setBusy(false)
          setThreadId(next)
          void loadThreads()
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        }
      }, [threadId, threads, loadThreads])

      // Keep the pending card's elapsed counter moving while a run is in flight.
      useEffect(() => {
        if (pending === null) return undefined
        const timer = setInterval(() => setTick((value) => value + 1), 1000)
        return () => clearInterval(timer)
      }, [pending])

      // A run started before a reload finishes on the Host; pick it back up.
      useEffect(() => {
        const raw = localStorage.getItem(JOB_KEY)
        if (raw === null) return
        let saved
        try { saved = JSON.parse(raw) } catch { localStorage.removeItem(JOB_KEY); return }
        if (typeof saved?.jobId !== 'string') { localStorage.removeItem(JOB_KEY); return }
        if (typeof saved.thread === 'string' && saved.thread.length > 0) {
          setThreadId(saved.thread)
          try { localStorage.setItem(THREAD_KEY, saved.thread) } catch { /* the choice stays in memory */ }
        }
        setBusy(true)
        setPending({
          prompt: saved.prompt ?? '',
          provider: saved.provider,
          providerName: saved.providerName,
          model: saved.model,
          aspect: saved.aspect,
          resolution: saved.resolution,
          startedAt: Number(saved.startedAt) || Date.now(),
        })
        void (async () => {
          try {
            const record = await awaitJob(saved.jobId)
            if (record !== null) {
              setRecords((current) => current.some((row) => row.id === record.id)
                ? current
                : [...current, record])
              void loadThreads()
            }
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure))
          } finally {
            localStorage.removeItem(JOB_KEY)
            setBusy(false)
            setPending(null)
            requestAnimationFrame(scrollToBottom)
          }
        })()
      }, [scrollToBottom, loadThreads])

      const modelGroups = useMemo(() => {
        const rows = catalog?.providers ?? []
        const flat = (list) => list.flatMap((row) => row.models.map((model) => ({
          value: `${row.id}::${model.id}`,
          label: model.name,
          hint: row.name,
          hasKey: row.hasKey,
          capabilities: model.capabilities,
        })))
        return {
          image: flat(rows.filter((row) => row.imageHint)),
          other: flat(rows.filter((row) => !row.imageHint)),
        }
      }, [catalog])

      const currentModel = `${form.providerId}::${form.model}`
      const currentKnown = [...modelGroups.image, ...modelGroups.other].some((row) => row.value === currentModel)

      /** What the selected model accepts; everything stays open while unknown. */
      const caps = useMemo(() => {
        const found = [...modelGroups.image, ...modelGroups.other].find((row) => row.value === currentModel)
        return found?.capabilities ?? {
          family: 'unknown',
          resolutions: ['1K', '1.5K', '2K', '4K'],
          fixedResolution: null,
          aspects: PRESET_RATIOS,
          allowCustomAspect: true,
          sizes: null,
          seed: true,
          negativePrompt: true,
          quality: true,
          outputFormat: true,
          /** Unknown models are assumed to accept references. */
          edit: true,
          maxCount: 4,
          notes: [],
        }
      }, [modelGroups, currentModel])

      // Keep the form inside what the model accepts whenever the model changes.
      useEffect(() => {
        setForm((current) => {
          const next = { ...current }
          let changed = false
          if (!caps.aspects.includes(next.aspect)) { next.aspect = caps.aspects[0]; changed = true }
          if (caps.fixedResolution !== null && next.resolution !== caps.fixedResolution) {
            next.resolution = caps.fixedResolution; changed = true
          } else if (!caps.resolutions.includes(next.resolution)) {
            next.resolution = caps.resolutions[0]; changed = true
          }
          if ((Number(next.count) || 1) > caps.maxCount) { next.count = 1; changed = true }
          if (!caps.allowCustomAspect && next.customAspect !== '') { next.customAspect = ''; changed = true }
          if (!caps.seed && next.seed !== '') { next.seed = ''; changed = true }
          if (!caps.negativePrompt && next.negativePrompt !== '') { next.negativePrompt = ''; changed = true }
          if (!caps.quality && next.quality !== '') { next.quality = ''; changed = true }
          return changed ? next : current
        })
      }, [caps])

      /**
       * Turn dropped, pasted, or picked files into reference images.
       * @param files - candidate files, filtered to image types.
       * @returns the new reference list.
       */
      const addReferences = useCallback(async (files) => {
        const images = [...files].filter((file) => file !== null && String(file.type).startsWith('image/'))
        if (images.length === 0) return
        const encoded = []
        for (const file of images.slice(0, 4)) {
          const text = await new Promise((accept, reject) => {
            const reader = new FileReader()
            reader.onload = () => { accept(String(reader.result)) }
            reader.onerror = () => { reject(new Error('reference read failed')) }
            reader.readAsDataURL(file)
          })
          encoded.push(text)
        }
        setForm((current) => ({ ...current, references: [...current.references, ...encoded].slice(0, 4) }))
      }, [])

      /**
       * Paste a screenshot straight into the prompt box: any image on the
       * clipboard becomes a reference image instead of pasting its file name.
       * @param event - the textarea paste event.
       */
      const onPaste = useCallback((event) => {
        const clipboard = event.clipboardData
        if (clipboard === undefined || clipboard === null) return
        const files = []
        for (const item of [...(clipboard.items ?? [])]) {
          if (item.kind === 'file' && String(item.type).startsWith('image/')) {
            const file = item.getAsFile()
            if (file !== null) files.push(file)
          }
        }
        // Firefox exposes the payload as plain files rather than items.
        if (files.length === 0) {
          for (const file of [...(clipboard.files ?? [])]) {
            if (String(file.type).startsWith('image/')) files.push(file)
          }
        }
        if (files.length === 0) return
        event.preventDefault()
        void addReferences(files)
      }, [addReferences])

      /** Accept an image dragged onto the prompt box. */
      const onDrop = useCallback((event) => {
        const transfer = event.dataTransfer
        if (transfer === undefined || transfer === null) return
        const files = [...(transfer.files ?? [])]
        if (!files.some((file) => String(file.type).startsWith('image/'))) return
        event.preventDefault()
        void addReferences(files)
      }, [addReferences])

      const onDragOver = useCallback((event) => {
        if (event.dataTransfer === undefined || event.dataTransfer === null) return
        event.preventDefault()
      }, [])

      /** Flip the chain switch and remember it across reloads. */
      const toggleChain = useCallback(() => {
        setChain((current) => {
          const next = !current
          try { localStorage.setItem(CHAIN_KEY, next ? 'on' : 'off') } catch { /* the switch stays in memory */ }
          return next
        })
      }, [])

      /** Flip the carry-prompt switch and remember it across reloads. */
      const toggleCarry = useCallback(() => {
        setCarry((current) => {
          const next = !current
          try { localStorage.setItem(CARRY_KEY, next ? 'on' : 'off') } catch { /* the switch stays in memory */ }
          return next
        })
      }, [])

      /**
       * Take one finished picture and set the composer up to edit it: the same
       * model and size, the old prompt in place, that image as the reference.
       * @param record - the run to continue from.
       */
      const continueFrom = useCallback(async (record) => {
        const image = Array.isArray(record.images) ? record.images[0] : undefined
        if (image === undefined) return
        const dataURL = await imageToDataURL(image.url)
        if (dataURL === undefined) {
          setError(LANG === 'zh' ? '读回上一张图失败' : 'could not read that image back')
          return
        }
        const preset = PRESET_RATIOS.includes(record.aspect)
        setForm((current) => ({
          ...current,
          protocol: record.protocol,
          providerId: record.provider,
          model: record.model,
          prompt: record.prompt,
          negativePrompt: record.negativePrompt ?? '',
          aspect: preset ? record.aspect : '1:1',
          customAspect: preset ? '' : String(record.aspect ?? ''),
          resolution: record.resolution,
          outputFormat: record.outputFormat ?? 'png',
          references: [dataURL],
        }))
        // The old wording is already in the box, so carrying it again would double it.
        setCarry(false)
        try { localStorage.setItem(CARRY_KEY, 'off') } catch { /* the switch stays in memory */ }
        promptRef.current?.focus()
      }, [])

      /** Drop one reference image by its position. */
      const removeReference = useCallback((index) => {
        setForm((current) => ({
          ...current,
          references: current.references.filter((_, position) => position !== index),
        }))
      }, [])

      const submit = useCallback(async () => {
        if (busy) return
        if (form.prompt.trim().length === 0) {
          setError(LANG === 'zh' ? '先写提示词' : 'write a prompt first')
          promptRef.current?.focus()
          return
        }
        const sentPrompt = form.prompt
        const aspect = parseRatio(form.customAspect) ?? form.aspect
        let sentReferences = [...form.references]
        let carriedFrom
        // Chained runs carry the previous picture as their reference, unless the
        // composer already holds one.
        if (sentReferences.length === 0 && chain) {
          const previous = [...records].reverse()
            .find((row) => Array.isArray(row.images) && row.images.length > 0)
          if (previous !== undefined) {
            const carried = await imageToDataURL(previous.images[0].url)
            if (carried !== undefined) {
              sentReferences = [carried]
              carriedFrom = previous
            }
          }
        }
        // "Carry prompt" resends the previous wording ahead of the new request,
        // which is what keeps a chained edit anchored to the same subject.
        const effectivePrompt = carriedFrom !== undefined && carry
          && typeof carriedFrom.prompt === 'string' && carriedFrom.prompt.length > 0
          ? `${carriedFrom.prompt}\n\n${
            LANG === 'zh' ? '在此基础上修改：' : 'Change from here: '}${sentPrompt}`
          : sentPrompt
        setBusy(true)
        setError(null)
        setFailed(null)
        const submittingThread = threadId
        // The prompt leaves the composer at once and becomes a message in the stream.
        setPending({
          prompt: effectivePrompt,
          provider: form.providerId,
          providerName: catalog?.providers.find((row) => row.id === form.providerId)?.name,
          model: form.model,
          aspect,
          resolution: form.resolution,
          startedAt: Date.now(),
        })
        // Both the text and the references leave the composer at once.
        setForm((current) => ({ ...current, prompt: '', references: [] }))
        requestAnimationFrame(scrollToBottom)
        try {
          const payload = {
            protocol: form.protocol,
            provider: form.providerId,
            model: form.model,
            prompt: effectivePrompt,
            negativePrompt: form.negativePrompt,
            aspect,
            resolution: form.resolution,
            seed: form.seed === '' ? undefined : Number(form.seed),
            quality: form.quality === '' ? undefined : form.quality,
            outputFormat: form.outputFormat,
            references: sentReferences,
            thread: submittingThread,
          }
          const response = await fetch(`${API}/generate`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          const body = await response.json()
          if (!body.ok) throw new Error(body.error?.message ?? 'generation failed')
          const jobId = body.job?.id
          if (typeof jobId !== 'string') throw new Error('generation job was not accepted')
          // Remembered so a page switch or reload picks the same run back up.
          localStorage.setItem(JOB_KEY, JSON.stringify({
            jobId,
            thread: submittingThread,
            prompt: effectivePrompt,
            provider: form.providerId,
            providerName: catalog?.providers.find((row) => row.id === form.providerId)?.name,
            model: form.model,
            aspect,
            resolution: form.resolution,
            startedAt: Date.now(),
          }))
          const record = await awaitJob(jobId)
          localStorage.removeItem(JOB_KEY)
          if (record !== null && activeThreadRef.current === submittingThread) {
            setRecords((current) => current.some((row) => row.id === record.id)
              ? current
              : [...current, record])
          }
          void loadThreads()
          requestAnimationFrame(() => {
            scrollToBottom()
            promptRef.current?.focus()
          })
        } catch (failure) {
          if (activeThreadRef.current === submittingThread) {
            setError(failure instanceof Error ? failure.message : String(failure))
            // 上游已出图、只是没下下来：给出「手动重下」，不重跑生成
            if (Array.isArray(failure?.urls) && failure.urls.length > 0) {
              setFailed({ id: failure.jobId ?? null, urls: failure.urls, thread: submittingThread })
            }
          }
          localStorage.removeItem(JOB_KEY)
          // Hand the text and the references back so nothing is lost.
          setForm((current) => ({
            ...current,
            prompt: current.prompt.length === 0 ? sentPrompt : current.prompt,
            references: current.references.length === 0 ? sentReferences : current.references,
          }))
        } finally {
          if (activeThreadRef.current === submittingThread) {
            setBusy(false)
            setPending(null)
          }
        }
      }, [form, scrollToBottom, busy, catalog, chain, records, threadId, loadThreads])

      /**
       * 重拉上游直链：不重新生成，只把图下到磁盘、写进历史。
       * @param target - `{ id, urls, thread }`，来自失败任务。
       */
      const retryDownload = useCallback(async (target) => {
        if (target === null || retrying) return
        setRetrying(true)
        setError(null)
        try {
          const response = await fetch(`${API}/retry-download`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: target.id,
              urls: target.urls,
              thread: target.thread ?? threadId,
            }),
          })
          const body = await response.json()
          if (!body.ok) throw new Error(body.error?.message ?? 'retry failed')
          const record = body.record
          if (record !== null && record !== undefined) {
            setRecords((current) => (current.some((row) => row.id === record.id)
              ? current
              : [...current, record]))
          }
          if (Array.isArray(body.failures) && body.failures.length > 0) {
            setError(body.failures.join(' / '))
          } else {
            setFailed(null)
          }
          void loadThreads()
          requestAnimationFrame(scrollToBottom)
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setRetrying(false)
        }
      }, [retrying, threadId, loadThreads, scrollToBottom])

      /** 复制失败任务的直链，一行一条。 */
      const copyFailedLinks = useCallback((urls) => {
        const text = (Array.isArray(urls) ? urls : []).join('\n')
        if (text.length === 0) return
        try {
          void navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        } catch { /* 剪贴板不可用时忽略 */ }
      }, [])

      const reuse = useCallback((record) => {
        const preset = PRESET_RATIOS.includes(record.aspect)
        setForm((current) => ({
          ...current,
          protocol: record.protocol,
          providerId: record.provider,
          model: record.model,
          prompt: record.prompt,
          negativePrompt: record.negativePrompt ?? '',
          aspect: preset ? record.aspect : '1:1',
          customAspect: preset ? '' : String(record.aspect ?? ''),
          resolution: record.resolution,
          count: record.count ?? 1,
          outputFormat: record.outputFormat ?? 'png',
        }))
        promptRef.current?.focus()
      }, [])

      const runProbe = useCallback(async (withSizes) => {
        setProbing(true)
        setError(null)
        try {
          const sizes = withSizes ? ['1024x1024', '1536x1024', '1024x1536'] : []
          const response = await fetch(`${API}/probe`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: form.providerId, model: form.model, sizes }),
          })
          const body = await response.json()
          if (!body.ok) throw new Error(body.error?.message ?? 'probe failed')
          setRecords((current) => [...current, {
            id: `probe-${Date.now()}`,
            kind: 'probe',
            probe: body.probe,
            createdAt: new Date().toISOString(),
          }])
          requestAnimationFrame(scrollToBottom)
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setProbing(false)
        }
      }, [form.providerId, form.model, scrollToBottom])

      /**
       * Enter sends, Shift+Enter breaks the line, and an IME composition
       * session is left alone so picking a Chinese candidate never fires a run.
       * @param event - the textarea or single-line key event.
       * @param allowNewline - whether Shift+Enter keeps its default newline.
       */
      const onKeyDown = useCallback((event, allowNewline) => {
        if (event.key !== 'Enter') return
        if (event.nativeEvent?.isComposing === true) return
        if (event.nativeEvent?.keyCode === 229) return
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault()
          void submit()
          return
        }
        if (allowNewline === true && event.shiftKey) return
        event.preventDefault()
        void submit()
      }, [submit])

      const protocols = catalog?.protocols ?? []
      const ratios = catalog?.ratios ?? ['1:1']
      const resolutions = catalog?.resolutions ?? ['1K']

      const composer = h('div', {
        style: { flex: '0 0 auto', padding: '10px 18px 16px' },
      },
        h('div', {
          onPaste,
          onDrop,
          onDragOver,
          style: {
            maxWidth: 1040, margin: '0 auto',
            borderRadius: 16, padding: '12px 14px',
            background: 'var(--dsw-alias-bg-layer-1)',
            border: `1px solid ${focused ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)'}`,
            boxShadow: focused ? '0 3px 14px rgba(0,0,0,0.10)' : '0 2px 10px rgba(0,0,0,0.06)',
            transition: 'border-color 120ms ease, box-shadow 120ms ease',
            display: 'flex', flexDirection: 'column', gap: 9,
          },
        },
          form.references.length > 0
            ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              form.references.map((src, index) => h('div', {
                key: index,
                style: {
                  position: 'relative', width: 52, height: 52, borderRadius: 8, overflow: 'hidden',
                  border: '1px solid var(--dsw-alias-border-l1)',
                },
              },
                h('img', { src, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover' } }),
                h('button', {
                  type: 'button',
                  onClick: () => removeReference(index),
                  title: t.text('clearImage'),
                  style: {
                    position: 'absolute', top: 0, right: 0, width: 16, height: 16,
                    padding: 0, border: 'none', cursor: 'pointer',
                    borderRadius: '0 0 0 6px', background: 'rgba(0,0,0,0.45)',
                    color: '#fff', fontSize: 11, lineHeight: '16px', fontFamily: 'inherit',
                  },
                }, '×'))),
              h(GhostButton, { onClick: () => patch({ references: [] }) }, t.text('clearImage')),
              caps.edit ? null : h('span', {
                style: { fontSize: 11, color: 'var(--dsw-alias-state-warn-primary)' },
              }, t.text('limitedEdit')))
            : null,

          h('textarea', {
            ref: promptRef,
            value: form.prompt,
            onChange: (event) => patch({ prompt: event.target.value }),
            onKeyDown: (event) => onKeyDown(event, true),
            onFocus: () => setFocused(true),
            onBlur: () => setFocused(false),
            placeholder: t.text('promptHint'),
            rows: 3,
            style: {
              width: '100%', boxSizing: 'border-box', resize: 'vertical',
              padding: '4px 2px', border: 'none', outline: 'none', background: 'transparent',
              fontSize: 14, lineHeight: 1.6, fontFamily: 'inherit',
              color: 'var(--dsw-alias-label-primary)',
            },
          }),

          showNegative
            ? h('input', {
              value: form.negativePrompt,
              onChange: (event) => patch({ negativePrompt: event.target.value }),
              onKeyDown: (event) => onKeyDown(event, false),
              placeholder: t.text('negativeHint'),
              style: { ...controlStyle, width: '100%' },
            })
            : null,

          showAdvanced
            ? h('div', {
              style: {
                display: 'grid', gap: 10, padding: '10px 0 2px',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                borderTop: '1px dashed var(--dsw-alias-border-l1)',
              },
            },
              h(Field, { label: t.text('protocol') },
                h('select', {
                  value: form.protocol,
                  onChange: (event) => patch({ protocol: event.target.value }),
                  style: controlStyle,
                }, protocols.map((row) => h('option', { key: row.id, value: row.id },
                  row.id === 'auto' ? t.text('autoProtocol') : row.label)))),
              h(Field, { label: t.text('customRatio') },
                caps.allowCustomAspect
                  ? h('input', {
                    value: form.customAspect,
                    onChange: (event) => patch({ customAspect: event.target.value }),
                    placeholder: '16:9',
                    style: { ...controlStyle, width: '100%' },
                  })
                  : h('input', {
                    value: t.text('fixedByModel'),
                    disabled: true,
                    style: { ...controlStyle, width: '100%', opacity: 0.6 },
                  })),
              h(Field, { label: t.text('seed') },
                h('input', {
                  value: caps.seed ? form.seed : '',
                  onChange: (event) => patch({ seed: event.target.value }),
                  placeholder: caps.seed ? 'random' : t.text('unsupported'),
                  disabled: !caps.seed,
                  inputMode: 'numeric',
                  style: { ...controlStyle, opacity: caps.seed ? 1 : 0.5 },
                })),
              caps.quality
                ? h(Field, { label: t.text('quality') },
                  h('select', {
                    value: form.quality,
                    onChange: (event) => patch({ quality: event.target.value }),
                    style: controlStyle,
                  },
                    h('option', { value: '' }, '—'),
                    ['low', 'medium', 'high'].map((value) => h('option', { key: value, value }, value))))
                : null,
              caps.outputFormat
                ? h(Field, { label: t.text('format') },
                  h('select', {
                    value: form.outputFormat,
                    onChange: (event) => patch({ outputFormat: event.target.value }),
                    style: controlStyle,
                  }, ['png', 'jpeg', 'webp'].map((value) => h('option', { key: value, value }, value))))
                : null,
              h('div', {
                style: {
                  gridColumn: '1 / -1', display: 'flex', gap: 8,
                  flexWrap: 'wrap', paddingTop: 2,
                },
              },
                h(GhostButton, { onClick: () => { void runProbe(false) }, disabled: probing },
                  t.text('probeMeta')),
                h(GhostButton, { onClick: () => { void runProbe(true) }, disabled: probing },
                  probing ? t.text('probing') : t.text('probeSizes'))))
            : null,

          caps.notes.length === 0
            ? null
            : h('div', {
              style: {
                display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'baseline',
                fontSize: 11, color: 'var(--dsw-alias-label-secondary)', paddingTop: 2,
              },
            },
              h('span', { style: { color: 'var(--dsw-alias-brand-primary)' } }, t.text('modelCaps')),
              h('span', null, caps.notes.join(' · '))),

          h('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
              borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 9,
            },
          },
            h('select', {
              value: currentKnown ? currentModel : '',
              onChange: (event) => {
                const [providerId, model] = event.target.value.split('::')
                patch({ providerId: providerId ?? '', model: model ?? '' })
              },
              title: t.text('model'),
              style: { ...controlStyle, maxWidth: 240 },
            },
              currentKnown ? null : h('option', { value: '' }, t.text('noModel')),
              modelGroups.image.length > 0
                ? h('optgroup', { label: t.text('imageModels') },
                  modelGroups.image.map((row) => h('option', { key: row.value, value: row.value },
                    `${row.label} · ${row.hint}${row.hasKey ? '' : ` · ${t.text('noKey')}`}`)))
                : null,
              modelGroups.other.length > 0
                ? h('optgroup', { label: t.text('otherModels') },
                  modelGroups.other.map((row) => h('option', { key: row.value, value: row.value },
                    `${row.label} · ${row.hint}`)))
                : null),

            h('select', {
              value: parseRatio(form.customAspect) ?? form.aspect,
              onChange: (event) => patch({ aspect: event.target.value, customAspect: '' }),
              title: t.text('ratio'),
              style: { ...controlStyle, minWidth: 108 },
            },
              caps.allowCustomAspect
                && parseRatio(form.customAspect) !== undefined
                && !caps.aspects.includes(parseRatio(form.customAspect))
                ? h('option', { value: parseRatio(form.customAspect) },
                  `${parseRatio(form.customAspect)} · ${t.text('customRatio')}`)
                : null,
              caps.aspects.map((value) => h('option', { key: value, value },
                RATIO_LABELS[value] === undefined ? value : `${value}  ${RATIO_LABELS[value]}`))),

            h('select', {
              value: form.resolution,
              onChange: (event) => patch({ resolution: event.target.value }),
              title: t.text('resolution'),
              disabled: caps.resolutions.length === 1,
              style: { ...controlStyle, opacity: caps.resolutions.length === 1 ? 0.6 : 1 },
            }, caps.resolutions.map((value) => h('option', { key: value, value }, value))),

            h(GhostButton, {
              onClick: () => setShowAdvanced((value) => !value),
              style: { padding: '6px 10px' },
            }, showAdvanced ? t.text('collapse') : t.text('advanced')),

            h(GhostButton, {
              onClick: toggleChain,
              title: t.text('chainHint'),
              style: {
                padding: '6px 10px',
                borderStyle: chain ? 'solid' : 'dashed',
                color: chain ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
              },
            }, chain ? t.text('chain') : t.text('chainOff')),

            h(GhostButton, {
              onClick: toggleCarry,
              disabled: !chain,
              title: t.text('carryHint'),
              style: {
                padding: '6px 10px',
                borderStyle: carry ? 'solid' : 'dashed',
                opacity: chain ? 1 : 0.45,
                color: carry ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
              },
            }, carry ? t.text('carry') : t.text('carryOff')),

            h(GhostButton, {
              onClick: () => setShowNegative((value) => !value),
              disabled: !caps.negativePrompt,
              title: caps.negativePrompt ? undefined : t.text('unsupported'),
              style: {
                padding: '6px 10px',
                borderStyle: showNegative ? 'solid' : 'dashed',
                opacity: caps.negativePrompt ? 1 : 0.45,
                color: form.negativePrompt.length > 0
                  ? 'var(--dsw-alias-brand-primary)'
                  : 'var(--dsw-alias-label-secondary)',
              },
            }, t.text('negative')),

            h('span', { style: { flex: 1 } }),

            h('button', {
              type: 'button',
              onClick: submit,
              disabled: busy,
              title: `${t.text('generate')}  ·  Enter`,
              style: {
                width: 34, height: 34, borderRadius: '50%', border: 'none',
                flex: '0 0 auto', display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center',
                cursor: busy ? 'default' : 'pointer',
                background: busy
                  ? 'var(--dsw-alias-state-idle-primary)'
                  : 'var(--dsw-alias-brand-primary)',
                opacity: busy ? 0.85 : 1,
                transition: 'opacity 120ms ease, transform 120ms ease',
              },
            },
              busy
                ? h('span', {
                  style: {
                    width: 14, height: 14, borderRadius: '50%',
                    border: '2px solid rgba(255,255,255,0.45)',
                    borderTopColor: '#fff',
                    display: 'inline-block',
                    animation: 'dsh-image-studio-spin 0.8s linear infinite',
                  },
                })
                : h('svg', {
                  width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
                  stroke: '#fff', strokeWidth: 2.4,
                  strokeLinecap: 'round', strokeLinejoin: 'round',
                  'aria-hidden': true,
                },
                  h('path', { d: 'M12 19V6' }),
                  h('path', { d: 'M6 12l6-6 6 6' }))))))

      const stream = h('div', {
        ref: streamRef,
        onScroll: onStreamScroll,
        style: {
          flex: '1 1 auto', minHeight: 0, overflowY: 'auto',
          display: 'flex', flexDirection: 'column',
          padding: '8px 18px 4px',
        },
      },
        h('div', {
          style: {
            maxWidth: 1040, width: '100%', margin: '0 auto',
            display: 'flex', flexDirection: 'column', gap: 20,
            flex: '1 1 auto',
          },
        },
          records.length === 0 && pending === null ? h(EmptyState) : null,
          records.map((record) => h(RunRow, {
            key: record.id,
            record,
            onReuse: reuse,
            onContinue: continueFrom,
            onOpen: (images, index) => setViewer({ images, index }),
          })),
          pending === null ? null : h(UserBubble, { record: pending }),
          pending === null ? null : h(PendingCard, { startedAt: pending.startedAt }),
          h(FailedCard, {
            failed,
            retrying,
            copied,
            onRetry: retryDownload,
            onCopy: copyFailedLinks,
          }),
          error !== null
            ? h('div', {
              style: {
                fontSize: 12, lineHeight: 1.6, padding: '9px 12px', borderRadius: 10,
                color: 'var(--dsw-alias-state-error-primary)',
                background: 'var(--dsw-alias-bg-layer-1)',
                border: '1px solid var(--dsw-alias-state-error-primary)',
                wordBreak: 'break-word',
              },
            }, error)
            : null))

      return h('div', {
        style: {
          display: 'flex', flexDirection: 'column',
          height: '100%', minHeight: 0, width: '100%', boxSizing: 'border-box',
          color: 'var(--dsw-alias-label-primary)',
          background: 'var(--dsw-alias-bg-base)',
          fontFamily: 'inherit',
        },
      },
        h('style', null,
          '@keyframes dsh-image-studio-spin{to{transform:rotate(360deg)}}'
          + '@keyframes dsh-image-studio-shimmer{0%{background-position:180% 0}100%{background-position:-80% 0}}'),
        h('div', {
          style: {
            flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 20px 6px',
          },
        },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 } },
            h('div', {
              style: { fontSize: 15, fontWeight: 650, color: 'var(--dsw-alias-label-primary)' },
            }, t.text('title')),
            h('div', {
              style: {
                fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              },
            }, t.text('subtitle'))),
          h('span', { style: { flex: 1 } }),
          h('select', {
            value: threadId,
            onChange: (event) => switchThread(event.target.value),
            title: t.text('thread'),
            style: { ...controlStyle, maxWidth: 240 },
          },
            threads.some((row) => row.id === threadId)
              ? null
              : h('option', { value: threadId }, t.text('newThreadName')),
            threads.map((row) => h('option', { key: row.id, value: row.id },
              `${row.title}（${row.count}）`))),
          h(GhostButton, { onClick: newThread, style: { padding: '5px 10px' } }, t.text('newThread')),
          h(GhostButton, {
            onClick: () => {
              if (!confirmDelete) {
                setConfirmDelete(true)
                setTimeout(() => setConfirmDelete(false), 4000)
                return
              }
              void archiveThread()
            },
            title: t.text('deleteHint'),
            style: {
              padding: '5px 10px',
              color: confirmDelete ? 'var(--dsw-alias-state-error-primary)' : undefined,
              borderColor: confirmDelete ? 'var(--dsw-alias-state-error-primary)' : undefined,
            },
          }, confirmDelete ? t.text('deleteConfirm') : t.text('deleteThread')),
          h(GhostButton, {
            onClick: () => { void loadCatalog(); void loadHistory(threadId); void loadThreads() },
            style: { padding: '5px 10px' },
          }, t.text('refresh'))),
        stream,
        composer,
        viewer === null ? null : h(Lightbox, {
          images: viewer.images,
          index: viewer.index,
          onClose: () => setViewer(null),
          onStep: (delta) => setViewer((current) => {
            if (current === null) return current
            const count = current.images.length
            if (count === 0) return current
            return { ...current, index: (current.index + delta + count) % count }
          }),
        }))
    }

    /** Sidebar icon: a framed picture. */
    function PanelIcon(props) {
      const size = props?.size ?? 18
      const active = props?.active === true
      const color = active ? 'var(--dsw-alias-brand-primary)' : 'currentColor'
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: color, strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true,
      },
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3 }),
        h('circle', { cx: 8.5, cy: 9.5, r: 1.6 }),
        h('path', { d: 'M4 17.5l4.6-4.2 3.2 2.9 2.6-2.4 5.6 5.2' }))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        try {
          if (ctx.locale !== undefined) {
            ctx.effect(() => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'image-studio: dictionaries')
          }
        } catch { /* the page carries its own copy table */ }

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, ImageStudioPage))

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: ENTRY_ORDER,
          label: () => t.text('panel'),
        }, PanelIcon))
      },
    }
  },
})
