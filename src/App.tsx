import { useMemo, useState, type ReactNode } from 'react'
import { dockerRunToCompose, type ConversionResult } from './lib/dockerRun'
import { formatCompose, type FormatResult } from './lib/composeFormatter'

type Tab = 'convert' | 'format'
type ConversionState = { ok: true; result: ConversionResult } | { ok: false; error: string } | null

const RUN_EXAMPLE = `docker run -d --name my-nginx \\
  -p 8080:80 \\
  -v ./html:/usr/share/nginx/html:ro \\
  -e NGINX_HOST=example.com \\
  --restart unless-stopped \\
  nginx:latest`

const COMPOSE_EXAMPLE = `version: '3.8'
services:
  web:
    image: nginx:latest
    ports: ["8080:80"]
    environment:
      NGINX_HOST: example.com
    volumes:
      - ./html:/usr/share/nginx/html:ro`

function highlightInline(text: string): ReactNode[] {
  const parts = text.split(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|#.*$)/g).filter(Boolean)
  return parts.map((part, index) => {
    if (part.startsWith('"') || part.startsWith("'")) {
      return <span className="tok-string" key={index}>{part}</span>
    }
    if (part.startsWith('#')) {
      return <span className="tok-comment" key={index}>{part}</span>
    }
    if (/^(true|false|null|yes|no)$/i.test(part.trim())) {
      return <span className="tok-bool" key={index}>{part}</span>
    }
    if (/^-?\d+(?:\.\d+)?$/.test(part.trim())) {
      return <span className="tok-number" key={index}>{part}</span>
    }
    return <span key={index}>{part}</span>
  })
}

function highlightLine(line: string): ReactNode {
  if (line.trimStart().startsWith('#')) {
    return <span className="tok-comment">{line}</span>
  }
  const match = /^(\s*)([^-\s][^:]*?)(:)(.*)$/.exec(line)
  if (!match) return highlightInline(line)
  return (
    <>
      {match[1]}
      <span className="tok-key">{match[2]}</span>
      <span className="tok-punct">{match[3]}</span>
      {highlightInline(match[4])}
    </>
  )
}

function YamlCode({ code }: { code: string }) {
  return (
    <pre className="code"><code>
      {code.split('\n').map((line, index) => (
        <span className="code-line" key={index}>
          <span className="line-number">{index + 1}</span>
          <span className="line-content">{highlightLine(line) || ' '}</span>
        </span>
      ))}
    </code></pre>
  )
}

function CopyButton({ text, disabled }: { text: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <button className="ghost-button" onClick={handleCopy} disabled={disabled || !text}>
      {copied ? '✓ 已复制' : '复制'}
    </button>
  )
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">≡</div>
      <strong>{title}</strong>
      <span>{hint}</span>
    </div>
  )
}

function Icon({ name }: { name: 'run' | 'format' | 'shield' }) {
  if (name === 'shield') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3l7 3v5c0 4.5-3 8.4-7 10-4-1.6-7-5.5-7-10V6l7-3z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    )
  }
  if (name === 'run') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 7h14M5 12h9M5 17h14" />
        <circle cx="18" cy="12" r="1.5" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h16M4 12h10M4 18h13" />
      <path d="M17 15l3 3-3 3" />
    </svg>
  )
}

export default function App() {
  const [tab, setTab] = useState<Tab>('convert')
  const [runInput, setRunInput] = useState('')
  const [composeInput, setComposeInput] = useState('')
  const [indent, setIndent] = useState<2 | 4>(2)

  const conversion = useMemo<ConversionState>(() => {
    if (!runInput.trim()) return null
    try {
      return { ok: true, result: dockerRunToCompose(runInput) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '转换失败' }
    }
  }, [runInput])

  const formatting = useMemo<FormatResult | null>(() => {
    if (!composeInput.trim()) return null
    return formatCompose(composeInput, indent)
  }, [composeInput, indent])

  const conversionYaml = conversion?.ok ? conversion.result.yaml : ''

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-mark"><Icon name="run" /></span>
          <div>
            <h1>ComposeForge</h1>
            <p>Docker Run 转 Compose · YAML 格式化</p>
          </div>
        </div>
        <div className="privacy"><Icon name="shield" /> 纯本地处理，数据不上传</div>
      </header>

      <main className="main">
        <div className="tabs" role="tablist" aria-label="功能切换">
          <button
            className={`tab ${tab === 'convert' ? 'active' : ''}`}
            role="tab"
            aria-selected={tab === 'convert'}
            onClick={() => setTab('convert')}
          >
            <Icon name="run" />
            docker run 转 Compose
          </button>
          <button
            className={`tab ${tab === 'format' ? 'active' : ''}`}
            role="tab"
            aria-selected={tab === 'format'}
            onClick={() => setTab('format')}
          >
            <Icon name="format" />
            Compose 格式化
          </button>
        </div>

        {tab === 'convert' ? (
          <section className="panel" role="tabpanel">
            <div className="panel-head">
              <div>
                <h2>docker run → docker-compose.yml</h2>
                <p>粘贴命令即可自动转换，支持端口、挂载、环境变量、网络、健康检查等常用参数。</p>
              </div>
              <div className="actions">
                <button className="ghost-button" onClick={() => setRunInput(RUN_EXAMPLE)}>加载示例</button>
                <button className="ghost-button" onClick={() => setRunInput('')} disabled={!runInput}>清空</button>
              </div>
            </div>

            <div className="grid">
              <div className="editor">
                <div className="editor-head">
                  <span>docker run 命令</span>
                  <span className="muted">{runInput.length} 字符</span>
                </div>
                <textarea
                  value={runInput}
                  onChange={(event) => setRunInput(event.target.value)}
                  placeholder={'docker run -d --name web -p 8080:80 nginx:latest'}
                  spellCheck={false}
                />
              </div>

              <div className="editor output">
                <div className="editor-head">
                  <span>docker-compose.yml</span>
                  <CopyButton text={conversionYaml} />
                </div>
                {conversion?.ok ? (
                  <>
                    <YamlCode code={conversionYaml} />
                    <div className="status-bar">
                      <span className="badge ok">转换成功</span>
                      <span>服务名：<code>{conversion.result.serviceName}</code></span>
                    </div>
                  </>
                ) : (
                  <EmptyState
                    title={conversion ? '无法转换' : '等待输入'}
                    hint={conversion && !conversion.ok ? conversion.error : '在左侧粘贴 docker run 命令，结果会实时显示在这里'}
                  />
                )}
              </div>
            </div>

            {conversion?.ok && conversion.result.warnings.length > 0 && (
              <div className="notes">
                <strong>转换说明</strong>
                <ul>
                  {conversion.result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
                </ul>
              </div>
            )}
          </section>
        ) : (
          <section className="panel" role="tabpanel">
            <div className="panel-head">
              <div>
                <h2>docker-compose.yml 格式化</h2>
                <p>统一缩进与换行、校验语法、检查常见 Compose 配置问题，注释会保留。</p>
              </div>
              <div className="actions">
                <div className="segmented" aria-label="缩进宽度">
                  {([2, 4] as const).map((size) => (
                    <button
                      key={size}
                      className={indent === size ? 'active' : ''}
                      onClick={() => setIndent(size)}
                    >
                      {size} 空格
                    </button>
                  ))}
                </div>
                <button className="ghost-button" onClick={() => setComposeInput(COMPOSE_EXAMPLE)}>加载示例</button>
                <button className="ghost-button" onClick={() => setComposeInput('')} disabled={!composeInput}>清空</button>
              </div>
            </div>

            <div className="grid">
              <div className="editor">
                <div className="editor-head">
                  <span>原始 YAML</span>
                  <span className="muted">{composeInput.length} 字符</span>
                </div>
                <textarea
                  value={composeInput}
                  onChange={(event) => setComposeInput(event.target.value)}
                  placeholder={'services:\n  web:\n    image: nginx:latest'}
                  spellCheck={false}
                />
              </div>

              <div className="editor output">
                <div className="editor-head">
                  <span>格式化结果</span>
                  <CopyButton text={formatting?.ok ? formatting.yaml : ''} />
                </div>
                {formatting?.ok ? (
                  <>
                    <YamlCode code={formatting.yaml} />
                    <div className="status-bar">
                      <span className="badge ok">语法有效</span>
                      <span>{formatting.services} 个服务</span>
                      <span>{formatting.lines} 行</span>
                    </div>
                  </>
                ) : (
                  <EmptyState
                    title={formatting ? 'YAML 语法错误' : '等待输入'}
                    hint={formatting?.error ?? '在左侧粘贴 docker-compose.yml，格式化结果会实时显示在这里'}
                  />
                )}
              </div>
            </div>

            {formatting?.hints && formatting.hints.length > 0 && (
              <div className="notes">
                <strong>检查提示</strong>
                <ul>
                  {formatting.hints.map((hint, index) => <li key={index}>{hint}</li>)}
                </ul>
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="footer">
        所有转换均在浏览器本地完成 · 适配 Cloudflare Pages · Compose V2 语法
      </footer>
    </div>
  )
}
