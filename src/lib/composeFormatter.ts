import YAML from 'yaml'
import { SERVICE_KEY_ORDER } from './dockerRun.ts'

export interface FormatResult {
  yaml: string
  ok: boolean
  error?: string
  hints: string[]
  services: number
  lines: number
}

function forceBlockStyle(node: unknown): void {
  if (!node || typeof node !== 'object') return
  const value = node as {
    flow?: boolean
    items?: unknown[]
    key?: unknown
    value?: unknown
  }
  if ('flow' in value) value.flow = false
  if (Array.isArray(value.items)) value.items.forEach(forceBlockStyle)
  if (value.key) forceBlockStyle(value.key)
  if (value.value) forceBlockStyle(value.value)
}

interface PairLike {
  key: unknown
  value: unknown
}

function sortServiceDirectives(doc: YAML.Document.Parsed): void {
  if (!YAML.isMap(doc.contents)) return
  const services = doc.contents.get('services', true)
  if (!YAML.isMap(services)) return

  const rank = (pair: PairLike): number => {
    if (!YAML.isScalar(pair.key)) return -1
    return SERVICE_KEY_ORDER.indexOf(String(pair.key.value))
  }

  for (const servicePair of services.items) {
    const service = servicePair.value
    if (!YAML.isMap(service)) continue
    const items = service.items as PairLike[]
    const positions = new Map(items.map((item, index) => [item, index]))
    items.sort((a, b) => {
      const ar = rank(a)
      const br = rank(b)
      if (ar === -1 && br === -1) return positions.get(a)! - positions.get(b)!
      if (ar === -1) return 1
      if (br === -1) return -1
      return ar - br
    })
  }
}

export function formatCompose(input: string, indent: 2 | 4 = 2, sortDirectives = true): FormatResult {
  const hints: string[] = []

  if (!input.trim()) {
    return { yaml: '', ok: false, error: '请输入 docker-compose.yml 内容', hints, services: 0, lines: 0 }
  }

  if (input.includes('\t')) {
    hints.push('检测到 Tab 字符：YAML 缩进不允许使用 Tab，请检查缩进是否正确。')
  }

  try {
    const doc = YAML.parseDocument(input, { uniqueKeys: true })

    if (doc.errors.length > 0) {
      return {
        yaml: '',
        ok: false,
        error: doc.errors[0].message,
        hints,
        services: 0,
        lines: input.split('\n').length,
      }
    }

    forceBlockStyle(doc.contents)
    if (sortDirectives) sortServiceDirectives(doc)

    const yaml = doc.toString({
      indent,
      lineWidth: 0,
      singleQuote: false,
      minContentWidth: 0,
    })

    const root = doc.toJS()
    const services = root && typeof root === 'object' && !Array.isArray(root)
      ? (root as Record<string, unknown>).services
      : undefined

    if (!services || typeof services !== 'object' || Array.isArray(services)) {
      hints.push('未找到有效的 services 根节点，请确认这是 Compose 文件。')
    } else {
      const entries = Object.entries(services as Record<string, unknown>)
      for (const [name, config] of entries) {
        if (!config || typeof config !== 'object' || Array.isArray(config)) {
          hints.push(`服务 ${name} 的配置不是对象，请检查缩进。`)
        } else {
          const service = config as Record<string, unknown>
          if (!service.image && !service.build) {
            hints.push(`服务 ${name} 缺少 image 或 build 字段。`)
          }
        }
      }
      if ('version' in (root as Record<string, unknown>)) {
        hints.push('Compose V2 已不再需要 version 字段，可安全删除。')
      }
    }

    return {
      yaml,
      ok: true,
      hints,
      services: services && typeof services === 'object' && !Array.isArray(services)
        ? Object.keys(services as Record<string, unknown>).length
        : 0,
      lines: yaml.split('\n').length,
    }
  } catch (error) {
    return {
      yaml: '',
      ok: false,
      error: error instanceof Error ? error.message : '格式化失败，请检查 YAML 语法',
      hints,
      services: 0,
      lines: input.split('\n').length,
    }
  }
}
