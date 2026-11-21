import YAML from 'yaml'

export interface ConversionResult {
  yaml: string
  serviceName: string
  warnings: string[]
}

interface Context {
  service: Record<string, unknown>
  warnings: string[]
  suggestedName?: string
  networkName?: string
  aliases: string[]
  ipv4?: string
  ipv6?: string
  logging: Record<string, unknown>
  health: Record<string, unknown>
}

interface OptionDef {
  long: string
  aliases?: string[]
  short?: string
  takesValue: boolean
  apply: (ctx: Context, value: string) => void
}

function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let hasToken = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (quote) {
      if (ch === quote) {
        quote = null
        continue
      }
      if (ch === '\\' && quote === '"' && i + 1 < input.length) {
        const next = input[i + 1]
        const escaped: Record<string, string> = { n: '\n', t: '\t', r: '\r' }
        current += escaped[next] ?? next
        i++
        continue
      }
      current += ch
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      hasToken = true
      continue
    }

    if (ch === '\\') {
      if (i + 1 < input.length) {
        const next = input[i + 1]
        if (next === '\n') {
          i++
          continue
        }
        current += next
        hasToken = true
        i++
      } else {
        current += ch
        hasToken = true
      }
      continue
    }

    if (ch === '#' && !hasToken) {
      while (i < input.length && input[i] !== '\n') i++
      continue
    }

    if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current)
        current = ''
        hasToken = false
      }
      continue
    }

    current += ch
    hasToken = true
  }

  if (quote) throw new Error(`引号未闭合：缺少 ${quote} 对应的结束引号`)
  if (hasToken) tokens.push(current)
  return tokens
}

function set(ctx: Context, key: string, value: unknown): void {
  ctx.service[key] = value
}

function setNumber(ctx: Context, key: string, raw: string): void {
  const value = Number(raw)
  set(ctx, key, Number.isFinite(value) && raw.trim() !== '' ? value : raw)
}

function appendList(ctx: Context, key: string, value: unknown): void {
  const existing = ctx.service[key]
  if (Array.isArray(existing)) existing.push(value)
  else ctx.service[key] = [value]
}

function setPair(ctx: Context, key: string, raw: string): void {
  const index = raw.indexOf('=')
  const name = index === -1 ? raw : raw.slice(0, index)
  const value = index === -1 ? null : raw.slice(index + 1)
  const existing = ctx.service[key]
  const pairs = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? existing as Record<string, string | null>
    : {}
  pairs[name] = value
  ctx.service[key] = pairs
}

function parseMount(raw: string): string | Record<string, unknown> {
  const parts: Record<string, string> = {}
  for (const part of raw.split(',')) {
    const index = part.indexOf('=')
    if (index === -1) parts[part.trim()] = 'true'
    else parts[part.slice(0, index).trim()] = part.slice(index + 1).trim()
  }

  const type = parts.type ?? 'volume'
  const source = parts.source ?? parts.src
  const target = parts.target ?? parts.dst ?? parts.destination
  if (!target) return raw

  if (type === 'tmpfs') return { type: 'tmpfs', target }

  const readOnly = parts.ro === 'true' || parts.readonly === 'true'
  return [source ? `${source}:${target}` : target, readOnly ? 'ro' : ''].filter(Boolean).join(':')
}

const VALUE_OPTIONS: OptionDef[] = [
  { long: 'publish', short: 'p', takesValue: true, apply: (c, v) => appendList(c, 'ports', v) },
  { long: 'volume', short: 'v', takesValue: true, apply: (c, v) => appendList(c, 'volumes', v) },
  { long: 'mount', takesValue: true, apply: (c, v) => appendList(c, 'volumes', parseMount(v)) },
  { long: 'env', short: 'e', takesValue: true, apply: (c, v) => setPair(c, 'environment', v) },
  { long: 'env-file', takesValue: true, apply: (c, v) => appendList(c, 'env_file', v) },
  { long: 'label', short: 'l', takesValue: true, apply: (c, v) => setPair(c, 'labels', v) },
  { long: 'name', takesValue: true, apply: (c, v) => { set(c, 'container_name', v); c.suggestedName = v } },
  { long: 'network', aliases: ['net'], takesValue: true, apply: (c, v) => { c.networkName = v } },
  { long: 'network-alias', takesValue: true, apply: (c, v) => c.aliases.push(v) },
  { long: 'ip', takesValue: true, apply: (c, v) => { c.ipv4 = v } },
  { long: 'ip6', takesValue: true, apply: (c, v) => { c.ipv6 = v } },
  { long: 'mac-address', takesValue: true, apply: (c, v) => set(c, 'mac_address', v) },
  { long: 'hostname', short: 'h', takesValue: true, apply: (c, v) => set(c, 'hostname', v) },
  { long: 'domainname', takesValue: true, apply: (c, v) => set(c, 'domainname', v) },
  { long: 'user', short: 'u', takesValue: true, apply: (c, v) => set(c, 'user', v) },
  { long: 'workdir', short: 'w', takesValue: true, apply: (c, v) => set(c, 'working_dir', v) },
  { long: 'entrypoint', takesValue: true, apply: (c, v) => set(c, 'entrypoint', v) },
  {
    long: 'restart',
    takesValue: true,
    apply: (c, v) => {
      const match = /^on-failure:\d+$/.exec(v)
      if (match) {
        c.warnings.push(`--restart ${v}：Compose 不支持重试次数，已转换为 on-failure`)
        set(c, 'restart', 'on-failure')
      } else set(c, 'restart', v)
    },
  },
  { long: 'add-host', takesValue: true, apply: (c, v) => appendList(c, 'extra_hosts', v) },
  { long: 'cap-add', takesValue: true, apply: (c, v) => appendList(c, 'cap_add', v) },
  { long: 'cap-drop', takesValue: true, apply: (c, v) => appendList(c, 'cap_drop', v) },
  { long: 'device', takesValue: true, apply: (c, v) => appendList(c, 'devices', v) },
  { long: 'device-cgroup-rule', takesValue: true, apply: (c, v) => appendList(c, 'device_cgroup_rules', v) },
  { long: 'dns', takesValue: true, apply: (c, v) => appendList(c, 'dns', v) },
  { long: 'dns-search', takesValue: true, apply: (c, v) => appendList(c, 'dns_search', v) },
  { long: 'dns-option', takesValue: true, apply: (c, v) => appendList(c, 'dns_opt', v) },
  { long: 'expose', takesValue: true, apply: (c, v) => appendList(c, 'expose', v) },
  { long: 'group-add', takesValue: true, apply: (c, v) => appendList(c, 'group_add', v) },
  { long: 'link', takesValue: true, apply: (c, v) => appendList(c, 'links', v) },
  {
    long: 'log-driver',
    takesValue: true,
    apply: (c, v) => { c.logging.driver = v },
  },
  {
    long: 'log-opt',
    takesValue: true,
    apply: (c, v) => {
      const index = v.indexOf('=')
      if (index <= 0) {
        c.warnings.push(`--log-opt ${v} 格式无效，已忽略`)
        return
      }
      const options = (c.logging.options ?? {}) as Record<string, string>
      options[v.slice(0, index)] = v.slice(index + 1)
      c.logging.options = options
    },
  },
  { long: 'pid', takesValue: true, apply: (c, v) => set(c, 'pid', v) },
  { long: 'pids-limit', takesValue: true, apply: (c, v) => setNumber(c, 'pids_limit', v) },
  { long: 'runtime', takesValue: true, apply: (c, v) => set(c, 'runtime', v) },
  { long: 'security-opt', takesValue: true, apply: (c, v) => appendList(c, 'security_opt', v) },
  { long: 'shm-size', takesValue: true, apply: (c, v) => set(c, 'shm_size', v) },
  { long: 'stop-signal', takesValue: true, apply: (c, v) => set(c, 'stop_signal', v) },
  { long: 'sysctl', takesValue: true, apply: (c, v) => appendList(c, 'sysctls', v) },
  { long: 'tmpfs', takesValue: true, apply: (c, v) => appendList(c, 'tmpfs', v) },
  { long: 'ulimit', takesValue: true, apply: (c, v) => appendList(c, 'ulimits', v) },
  { long: 'volumes-from', takesValue: true, apply: (c, v) => appendList(c, 'volumes_from', v) },
  { long: 'isolation', takesValue: true, apply: (c, v) => set(c, 'isolation', v) },
  { long: 'platform', takesValue: true, apply: (c, v) => set(c, 'platform', v) },
  {
    long: 'pull',
    takesValue: true,
    apply: (c, v) => set(c, 'pull_policy', v === 'missing' || v === 'if-not-present' ? 'if_not_present' : v),
  },
  { long: 'cpu-shares', short: 'c', takesValue: true, apply: (c, v) => setNumber(c, 'cpu_shares', v) },
  { long: 'cpus', takesValue: true, apply: (c, v) => setNumber(c, 'cpus', v) },
  { long: 'cpuset-cpus', takesValue: true, apply: (c, v) => set(c, 'cpuset', v) },
  { long: 'memory', short: 'm', takesValue: true, apply: (c, v) => set(c, 'mem_limit', v) },
  { long: 'memory-reservation', takesValue: true, apply: (c, v) => set(c, 'mem_reservation', v) },
  { long: 'memory-swap', takesValue: true, apply: (c, v) => set(c, 'memswap_limit', v) },
  { long: 'memory-swappiness', takesValue: true, apply: (c, v) => setNumber(c, 'mem_swappiness', v) },
  { long: 'oom-score-adj', takesValue: true, apply: (c, v) => setNumber(c, 'oom_score_adj', v) },
  { long: 'health-cmd', takesValue: true, apply: (c, v) => { c.health.test = ['CMD-SHELL', v] } },
  { long: 'health-interval', takesValue: true, apply: (c, v) => { c.health.interval = v } },
  { long: 'health-timeout', takesValue: true, apply: (c, v) => { c.health.timeout = v } },
  { long: 'health-retries', takesValue: true, apply: (c, v) => { c.health.retries = Number(v) || v } },
  { long: 'health-start-period', takesValue: true, apply: (c, v) => { c.health.start_period = v } },
  { long: 'health-start-interval', takesValue: true, apply: (c, v) => { c.health.start_interval = v } },
]

const BOOLEAN_OPTIONS: OptionDef[] = [
  {
    long: 'detach',
    short: 'd',
    takesValue: false,
    apply: (c) => c.warnings.push('-d/--detach：Compose 使用 docker compose up -d 后台运行'),
  },
  {
    long: 'publish-all',
    short: 'P',
    takesValue: false,
    apply: (c) => c.warnings.push('-P/--publish-all：Compose 需显式声明 ports，已忽略随机映射'),
  },
  { long: 'interactive', short: 'i', takesValue: false, apply: (c) => set(c, 'stdin_open', true) },
  { long: 'tty', short: 't', takesValue: false, apply: (c) => set(c, 'tty', true) },
  {
    long: 'rm',
    takesValue: false,
    apply: (c) => c.warnings.push('--rm：由 docker compose run --rm 控制，已忽略'),
  },
  { long: 'privileged', takesValue: false, apply: (c) => set(c, 'privileged', true) },
  { long: 'read-only', takesValue: false, apply: (c) => set(c, 'read_only', true) },
  { long: 'init', takesValue: false, apply: (c) => set(c, 'init', true) },
  { long: 'oom-kill-disable', takesValue: false, apply: (c) => set(c, 'oom_kill_disable', true) },
  { long: 'quiet', short: 'q', takesValue: false, apply: () => undefined },
]

const BY_LONG = new Map<string, OptionDef>()
const BY_SHORT = new Map<string, OptionDef>()
for (const def of [...VALUE_OPTIONS, ...BOOLEAN_OPTIONS]) {
  BY_LONG.set(def.long, def)
  for (const alias of def.aliases ?? []) BY_LONG.set(alias, def)
  if (def.short) BY_SHORT.set(def.short, def)
}

const KEY_ORDER = [
  'image', 'container_name', 'command', 'entrypoint', 'ports', 'expose', 'volumes', 'volumes_from',
  'environment', 'env_file', 'labels', 'network_mode', 'networks', 'hostname', 'domainname',
  'mac_address', 'dns', 'dns_search', 'dns_opt', 'extra_hosts', 'privileged', 'user', 'working_dir',
  'stdin_open', 'tty', 'restart', 'init', 'pid', 'pids_limit', 'healthcheck', 'logging', 'runtime',
  'shm_size', 'stop_signal', 'sysctls', 'tmpfs', 'security_opt', 'cap_add', 'cap_drop', 'devices',
  'links', 'isolation', 'platform', 'pull_policy', 'cpu_shares', 'cpus', 'cpuset', 'mem_limit',
  'mem_reservation', 'memswap_limit', 'mem_swappiness', 'oom_score_adj', 'oom_kill_disable', 'read_only',
]

function orderService(service: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(service).sort(([a], [b]) => {
    const ai = KEY_ORDER.indexOf(a)
    const bi = KEY_ORDER.indexOf(b)
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
  return Object.fromEntries(entries)
}

function sanitizeName(raw: string): string {
  const name = raw
    .toLowerCase()
    .replace(/@.*$/, '')
    .replace(/^.*\//, '')
    .replace(/:[^:]*$/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return name || 'app'
}

export function dockerRunToCompose(input: string): ConversionResult {
  const tokens = tokenize(input.trim())
  let index = 0

  if (tokens[0] === 'sudo') {
    index++
    while (tokens[index]?.includes('=')) index++
  }
  if (tokens[index] === 'docker' && tokens[index + 1] === 'container') index++
  if (tokens[index] !== 'docker' || tokens[index + 1] !== 'run') {
    throw new Error('请输入完整的 docker run 命令（需包含 docker run）')
  }
  index += 2

  const ctx: Context = {
    service: {},
    warnings: [],
    aliases: [],
    logging: {},
    health: {},
  }

  const looksLikeOption = (value: string) => value.startsWith('-') && value.length > 1

  while (index < tokens.length) {
    const token = tokens[index]
    if (token === '--') {
      index++
      break
    }
    if (!token.startsWith('-') || token === '-') break

    if (token.startsWith('--')) {
      const equal = token.indexOf('=')
      const name = equal === -1 ? token.slice(2) : token.slice(2, equal)
      const inlineValue = equal === -1 ? undefined : token.slice(equal + 1)
      const def = BY_LONG.get(name)
      if (!def) {
        ctx.warnings.push(`未识别选项 --${name}，已忽略`)
        index++
        continue
      }
      if (def.takesValue) {
        const value = inlineValue ?? tokens[index + 1]
        if (value === undefined || (inlineValue === undefined && looksLikeOption(value))) {
          ctx.warnings.push(`选项 --${name} 缺少参数，已跳过`)
          index++
          continue
        }
        def.apply(ctx, value)
        index += inlineValue === undefined ? 2 : 1
      } else {
        if (inlineValue !== undefined) ctx.warnings.push(`--${name} 不需要参数，已忽略 =${inlineValue}`)
        def.apply(ctx, '')
        index++
      }
      continue
    }

    const body = token.slice(1)
    for (let j = 0; j < body.length; j++) {
      const flag = body[j]
      const def = BY_SHORT.get(flag)
      if (!def) {
        ctx.warnings.push(`未识别选项 -${flag}，已忽略`)
        continue
      }
      if (!def.takesValue) {
        def.apply(ctx, '')
        continue
      }
      let rest = body.slice(j + 1)
      if (rest.startsWith('=')) rest = rest.slice(1)
      let value = rest
      if (!value) {
        const next = tokens[index + 1]
        if (next === undefined || looksLikeOption(next)) {
          ctx.warnings.push(`选项 -${flag} 缺少参数，已跳过`)
          break
        }
        value = next
        index++
      }
      def.apply(ctx, value)
      break
    }
    index++
  }

  const image = tokens[index]
  if (!image) throw new Error('缺少镜像名称，请检查命令是否完整')
  index++

  const serviceName = sanitizeName(ctx.suggestedName ?? image)
  ctx.service.image = image

  const command = tokens.slice(index)
  if (command.length) ctx.service.command = command.length === 1 ? command[0] : command

  if (ctx.networkName) {
    const name = ctx.networkName
    const isSpecial = ['host', 'none', 'bridge'].includes(name) || name.startsWith('container:') || name.startsWith('service:')
    if (isSpecial) {
      set(ctx, 'network_mode', name)
    } else {
      const config: Record<string, unknown> = {}
      if (ctx.aliases.length) config.aliases = ctx.aliases
      if (ctx.ipv4) config.ipv4_address = ctx.ipv4
      if (ctx.ipv6) config.ipv6_address = ctx.ipv6
      ctx.service.networks = { [name]: Object.keys(config).length ? config : null }
    }
  } else if (ctx.aliases.length || ctx.ipv4 || ctx.ipv6) {
    ctx.warnings.push('使用了 --network-alias/--ip 但未指定 --network，相关配置已忽略')
  }

  if (Object.keys(ctx.logging).length) ctx.service.logging = ctx.logging
  if (Object.keys(ctx.health).length) ctx.service.healthcheck = ctx.health

  const yaml = YAML.stringify({ services: { [serviceName]: orderService(ctx.service) } }, {
    indent: 2,
    lineWidth: 0,
    singleQuote: false,
  })

  return { yaml, serviceName, warnings: ctx.warnings }
}
