export type Tier = 0 | 1 | 2 | 3

export type Rating = { tier: Tier; reason: string }

export type Place = (path: string, base: string | undefined) => Promise<string | undefined>

export type Context = { root: string; place: Place }

export const TIER_NAMES = ['read only', 'edits in the project', 'reaches outside', 'destructive'] as const

const CREDENTIAL = [
  /^\.env(\..*)?$/i,
  /^\.envrc$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|key|pfx|p12|jks|keystore)$/i,
  /^credentials(\.json)?$/i,
  /^\.git-credentials$/i,
  /^\.netrc$/i,
  /^_netrc$/i,
  /^\.pgpass$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^secrets?\.(json|ya?ml|toml|txt)$/i,
]

const CREDENTIAL_DIRS = [/^\.ssh$/i, /^\.aws$/i, /^\.azure$/i, /^\.gnupg$/i, /^\.kube$/i]

const HARMLESS_TOOLS = new Set([
  'TodoWrite', 'AskUserQuestion', 'ToolSearch', 'EnterPlanMode', 'ExitPlanMode', 'TaskOutput', 'TaskStop',
])

const NETWORK_TOOLS = new Set(['WebFetch', 'WebSearch'])

const READ_COMMANDS = new Set([
  'ls', 'dir', 'cat', 'type', 'head', 'tail', 'less', 'more', 'grep', 'rg', 'egrep', 'fgrep', 'wc', 'pwd', 'echo',
  'printf', 'which', 'where', 'file', 'stat', 'du', 'df', 'tree', 'sort', 'uniq', 'cut', 'diff', 'cmp', 'basename',
  'dirname', 'realpath', 'true', 'false', 'date', 'whoami', 'hostname', 'printenv', 'test', '[',
  'get-content', 'gc', 'get-childitem', 'gci', 'select-string', 'sls', 'get-location', 'gl', 'test-path',
  'get-item', 'gi', 'get-itemproperty', 'resolve-path', 'measure-object', 'select-object', 'where-object',
  'sort-object', 'format-table', 'format-list', 'write-output', 'write-host', 'out-string', 'get-date',
  'get-command', 'gcm', 'get-help', 'get-process', 'gps', 'get-service', 'gsv', 'get-filehash', 'compare-object',
  'convertfrom-json', 'convertto-json', 'join-path', 'split-path',
])

const EDIT_COMMANDS = new Set([
  'mkdir', 'md', 'touch', 'cp', 'copy', 'mv', 'move', 'ren', 'rename', 'sed', 'tee', 'new-item', 'ni',
  'set-content', 'sc', 'add-content', 'ac', 'out-file', 'copy-item', 'cpi', 'move-item', 'mi', 'rename-item', 'rni',
  'new-itemproperty', 'set-item', 'si', 'clear-content', 'clc',
])

const DELETE_COMMANDS = new Set(['rm', 'rmdir', 'del', 'erase', 'rd', 'unlink', 'remove-item', 'ri', 'shred'])

const NETWORK_COMMANDS = new Set([
  'curl', 'wget', 'ssh', 'scp', 'sftp', 'rsync', 'ftp', 'nc', 'ncat', 'telnet', 'invoke-webrequest', 'iwr',
  'invoke-restmethod', 'irm', 'start-bitstransfer', 'test-netconnection', 'ping',
])

const CD_COMMANDS = new Set(['cd', 'chdir', 'pushd', 'popd', 'set-location', 'sl', 'push-location', 'pop-location'])

const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'blame', 'rev-parse', 'ls-files', 'grep', 'describe', 'shortlog'])
const GIT_EDIT = new Set(['add', 'commit', 'switch', 'checkout', 'restore', 'stash', 'merge', 'rebase', 'cherry-pick', 'tag', 'mv', 'rm', 'init', 'revert'])
const GIT_NETWORK = new Set(['push', 'pull', 'fetch', 'clone', 'remote', 'submodule', 'ls-remote'])

const rated = (tier: Tier, reason: string): Rating => ({ tier, reason })

const highest = (ratings: Rating[]): Rating =>
  ratings.reduce((a, b) => (b.tier > a.tier ? b : a), rated(0, 'reads only'))

const isWindowsPath = (p: string) => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')

const norm = (p: string) => {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return isWindowsPath(p) ? s.toLowerCase() : s
}

export const isInside = (real: string | undefined, root: string): boolean => {
  if (real === undefined) return false
  const r = norm(root)
  const p = norm(real)
  return p === r || p.startsWith(r + '/')
}

const parts = (p: string) => p.split(/[\\/]+/).filter(Boolean)

export const isCredentialPath = (p: string): boolean => {
  const segs = parts(p)
  const name = segs[segs.length - 1] ?? ''
  if (CREDENTIAL.some(re => re.test(name))) return true
  return segs.some(s => CREDENTIAL_DIRS.some(re => re.test(s)))
}

const mentionsCredential = (text: string): boolean =>
  text
    .split(/[\s'"`=,;|&<>()]+/)
    .filter(tok => tok !== '')
    .some(tok => isCredentialPath(tok) || (/[*?]/.test(tok) && ['', '.x'].some(fill => isCredentialPath(tok.replace(/[*?]+/g, fill)))))

async function ratePath(path: string | undefined, base: string | undefined, ctx: Context, write: boolean): Promise<Rating> {
  if (path === undefined || path === '') return write ? rated(1, 'edits in the project') : rated(0, 'reads in the project')
  if (isCredentialPath(path)) return rated(3, `touches a credential file: ${path}`)
  const real = await ctx.place(path, base)
  if (real !== undefined && isCredentialPath(real)) return rated(3, `touches a credential file: ${path}`)
  if (!isInside(real, ctx.root)) return rated(2, `outside the project: ${path}`)
  return write ? rated(1, `edits in the project: ${path}`) : rated(0, `reads in the project: ${path}`)
}

type Token = { text: string; quoted: boolean }

type Redirect = { target: string; isRead: boolean }

type Segment = { words: Token[]; redirects: Redirect[] }

const SEPARATORS = new Set([';', '&&', '||', '|', '&', '\n', '(', ')'])

export function tokenize(command: string): Segment[] | undefined {
  const segments: Segment[] = []
  let words: Token[] = []
  let redirects: Redirect[] = []
  let cur = ''
  let quoted = false
  let has = false
  let pendingRedirect = false
  let pendingRead = false
  const push = () => {
    if (!has) return
    if (pendingRedirect) {
      redirects.push({ target: cur, isRead: pendingRead })
      pendingRedirect = false
      pendingRead = false
    } else {
      words.push({ text: cur, quoted })
    }
    cur = ''
    quoted = false
    has = false
  }
  const end = () => {
    push()
    if (pendingRedirect) return false
    if (words.length || redirects.length) segments.push({ words, redirects })
    words = []
    redirects = []
    return true
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    const two = command.slice(i, i + 2)
    if (c === "'" || c === '"') {
      const close = command.indexOf(c, i + 1)
      if (close < 0) return undefined
      const inner = command.slice(i + 1, close)
      if (c === '"' && /\$\(|`/.test(inner)) return undefined
      cur += inner
      quoted = true
      has = true
      i = close
      continue
    }
    if (c === '`' || two === '$(' || two === '<(' || two === '>(') return undefined
    if (two === '<<') return undefined
    if (c === ' ' || c === '\t' || c === '\r') {
      push()
      continue
    }
    if (two === '&&' || two === '||') {
      if (!end()) return undefined
      i++
      continue
    }
    if (SEPARATORS.has(c)) {
      if (c === '&' && command[i + 1] === '>') {
        push()
        pendingRedirect = true
        i += command[i + 2] === '>' ? 2 : 1
        continue
      }
      if (!end()) return undefined
      continue
    }
    if (c === '>' || (c === '<' && command[i + 1] !== '<')) {
      const prefix = /^\d$/.test(cur) ? cur : ''
      if (prefix) {
        cur = ''
        has = false
      } else {
        push()
      }
      if (command[i + 1] === '&') {
        i += 1
        while (/\d/.test(command[i + 1] ?? '')) i++
        continue
      }
      if (command[i + 1] === '>') i++
      pendingRedirect = true
      pendingRead = c === '<'
      continue
    }
    cur += c
    has = true
  }
  if (!end()) return undefined
  return segments
}

const NULL_DEVICES = new Set(['/dev/null', 'nul', '$null', '/dev/stdout', '/dev/stderr'])

const isFlag = (t: Token) => /^-/.test(t.text) && t.text !== '-'

const pathArgs = (words: Token[]) => words.slice(1).filter(w => !isFlag(w)).map(w => w.text)

const hasFlag = (words: Token[], re: RegExp) => words.some(w => isFlag(w) && re.test(w.text))

const isRecursive = (cmd: string, words: Token[]) => {
  if (cmd === 'rm' || cmd === 'shred') return hasFlag(words, /^-[a-zA-Z]*[rR]|^--recursive$/)
  if (cmd === 'rmdir' || cmd === 'rd') return hasFlag(words, /^-[a-zA-Z]*[pP]|^--parents$/) || words.some(w => /^\/s$/i.test(w.text))
  if (cmd === 'del' || cmd === 'erase') return words.some(w => /^\/s$/i.test(w.text))
  return hasFlag(words, /^-r(e(c(u(r(s(e)?)?)?)?)?)?(:.*)?$/i)
}

const hasExpansion = (t: string) => /[$~%]/.test(t)

const PREFIX_COMMANDS = new Set(['sudo', 'doas', 'command', 'builtin', 'nohup', 'time', 'xargs', 'env', 'exec', 'nice', 'timeout', '&', '.'])

const PREFIX_VALUE_FLAGS: Record<string, Set<string>> = {
  sudo: new Set(['-u', '-g', '-C', '-h', '-p', '-r', '-t', '-U']),
  doas: new Set(['-u', '-C']),
  env: new Set(['-u', '-C', '-S']),
  xargs: new Set(['-n', '-s', '-P', '-L', '-I', '-d', '-E', '-a']),
  nice: new Set(['-n']),
  timeout: new Set(['-s', '-k']),
}

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell', 'cmd'])

const shellCommandFlag = (shell: string) =>
  shell === 'pwsh' || shell === 'powershell' ? /^-(c|command|e|ec|enc|encodedcommand)$/i : shell === 'cmd' ? /^\/[ck]$/i : /^-[a-z]*c$/

const GIT_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'])

const PATTERN_FIRST =new Set(['grep', 'rg', 'egrep', 'fgrep', 'select-string', 'sls'])

const globFolder = (a: string) => a.slice(0, Math.max(a.lastIndexOf('/'), a.lastIndexOf('\\')) + 1) || '.'

async function rateSegment(seg: Segment, base: string | undefined, ctx: Context, depth: number): Promise<Rating> {
  const ratings: Rating[] = []
  for (const { target, isRead } of seg.redirects) {
    if (NULL_DEVICES.has(target.toLowerCase())) continue
    if (isCredentialPath(target)) return rated(3, `touches a credential file: ${target}`)
    if (hasExpansion(target)) {
      ratings.push(rated(2, `redirects to a path it cannot place: ${target}`))
      continue
    }
    ratings.push(await ratePath(target, base, ctx, !isRead))
  }
  let words = seg.words.filter(w => w.quoted || (w.text !== '{' && w.text !== '}'))
  for (;;) {
    while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!.text)) words = words.slice(1)
    const head = words[0]?.text.toLowerCase()
    if (head === undefined || !PREFIX_COMMANDS.has(head)) break
    if (head === 'sudo' || head === 'doas') ratings.push(rated(2, 'runs as another user'))
    words = words.slice(1)
    while (words.length && isFlag(words[0]!)) {
      const flag = words[0]!.text
      words = words.slice(PREFIX_VALUE_FLAGS[head]?.has(flag) ? 2 : 1)
    }
    if (head === 'timeout' && /^\d+(\.\d+)?[smhd]?$/.test(words[0]?.text ?? '')) words = words.slice(1)
  }
  if (!words.length) return highest(ratings)
  const cmd = words[0]!.text.replace(/^\\/, '').split(/[\\/]/).pop()!.replace(/\.exe$/i, '').toLowerCase()
  const args = pathArgs(words)
  const all = words.map(w => w.text).join(' ')
  if (mentionsCredential(all)) return rated(3, `touches a credential file: ${all}`)

  if (SHELLS.has(cmd)) {
    const at = words.findIndex((w, i) => i > 0 && !w.quoted && shellCommandFlag(cmd).test(w.text))
    if (at < 0) return highest([...ratings, rated(2, `${cmd} runs a script or a shell`)])
    if (cmd !== 'cmd' && /^-(e|ec|enc|encodedcommand)$/i.test(words[at]!.text) && (cmd === 'pwsh' || cmd === 'powershell')) return highest([...ratings, rated(2, `${cmd} runs an encoded command it cannot read`)])
    if (depth >= 3) return highest([...ratings, rated(2, 'shells nested too deep to read')])
    const inner = words.slice(at + 1).map(w => w.text).join(' ')
    return highest([...ratings, await rateCommand(inner, ctx, base, depth + 1)])
  }

  if (DELETE_COMMANDS.has(cmd)) {
    if (isRecursive(cmd, words)) return rated(3, `recursive delete: ${all}`)
    if (!args.length) return rated(3, `deletes what the pipe or the prompt gives it: ${all}`)
    for (const a of args) {
      if (hasExpansion(a)) return rated(3, `deletes a path it cannot place: ${a}`)
      const real = await ctx.place(/[*?]/.test(a) ? globFolder(a) : a, base)
      if (!isInside(real, ctx.root)) return rated(3, `deletes outside the project: ${a}`)
    }
    ratings.push(rated(1, `deletes in the project: ${all}`))
    return highest(ratings)
  }

  if (cmd === 'git') {
    let at = 1
    while (at < words.length && isFlag(words[at]!)) {
      const flag = words[at]!.text
      if (flag === '-C') {
        const dir = words[at + 1]?.text
        const real = dir === undefined || hasExpansion(dir) ? undefined : await ctx.place(dir, base)
        if (!isInside(real, ctx.root)) ratings.push(rated(2, `git runs in a folder outside the project: ${dir ?? ''}`))
      }
      at += GIT_VALUE_FLAGS.has(flag) ? 2 : 1
    }
    const sub = words[at]?.text.toLowerCase()
    if (sub === undefined) return highest([...ratings, rated(0, 'git')])
    if (sub === 'push') {
      const forced = hasFlag(words, /^(-[a-zA-Z]*f[a-zA-Z]*|--force|--force-with-lease(=.*)?|--force-if-includes|--mirror|--delete|-d)$/) ||
        words.slice(2).some(w => /^\+/.test(w.text) || /^:/.test(w.text))
      if (forced) return rated(3, `force push: ${all}`)
      return highest([...ratings, rated(2, `git push: ${all}`)])
    }
    if (sub === 'reset' && hasFlag(words, /^--hard$/)) return rated(3, `hard reset: ${all}`)
    if (sub === 'clean' && hasFlag(words, /^-[a-zA-Z]*f|^--force$/)) return rated(3, `git clean deletes files: ${all}`)
    const rest = words.slice(at + 1)
    const has = (re: RegExp) => rest.some(w => re.test(w.text))
    const discards =
      (sub === 'checkout' && (has(/^(--|\.|-f|--force)$/))) ||
      (sub === 'switch' && has(/^(-f|--force|--discard-changes)$/)) ||
      (sub === 'restore' && !has(/^(--staged|-S)$/)) ||
      (sub === 'stash' && has(/^(drop|clear)$/)) ||
      (sub === 'branch' && (has(/^-D$/) || (has(/^(-d|--delete)$/) && has(/^(-f|--force)$/)))) ||
      (sub === 'reflog' && has(/^(expire|delete)$/)) ||
      (sub === 'gc' && has(/^--prune/))
    if (discards) return rated(3, `discards work git cannot give back: ${all}`)
    if (GIT_NETWORK.has(sub)) return highest([...ratings, rated(2, `git ${sub} reaches the network`)])
    if (GIT_READ.has(sub)) return highest([...ratings, rated(0, `git ${sub}`)])
    if (sub === 'branch' || sub === 'config') return highest([...ratings, rated(words.length > 2 ? 1 : 0, `git ${sub}`)])
    if (GIT_EDIT.has(sub)) return highest([...ratings, rated(1, `git ${sub} in the project`)])
    return highest([...ratings, rated(2, `git ${sub} is not rated`)])
  }

  if (NETWORK_COMMANDS.has(cmd)) return highest([...ratings, rated(2, `reaches the network: ${cmd}`)])

  if (cmd === 'find' && words.some(w => /^-(delete|exec|execdir|ok)$/.test(w.text))) {
    return rated(3, `find that deletes or runs commands: ${all}`)
  }

  const isRead = READ_COMMANDS.has(cmd) || cmd === 'find'
  const isEdit = EDIT_COMMANDS.has(cmd)
  if (!isRead && !isEdit) return highest([...ratings, rated(2, `command not rated: ${cmd}`)])
  const paths = PATTERN_FIRST.has(cmd) ? args.slice(1) : args
  for (const a of paths) {
    if (hasExpansion(a)) {
      ratings.push(rated(2, `a path it cannot place: ${a}`))
      continue
    }
    if (/[*?]/.test(a)) {
      ratings.push(await ratePath(globFolder(a), base, ctx, isEdit))
      continue
    }
    if (isRead && !/[\\/.]/.test(a) && !(await ctx.place(a, base))) continue
    ratings.push(await ratePath(a, base, ctx, isEdit))
  }
  if (!args.length) ratings.push(isEdit ? rated(1, `${cmd} in the project`) : rated(0, `${cmd}`))
  return highest(ratings)
}

const DESTRUCTIVE_TEXT = [
  /(^|[\s;|&({`'"$\\/])(rm|rmdir|rd|del|erase|unlink|shred|remove-item|ri)(\.exe)?(?=[\s;|&)}`'"]|$)/i,
  /\b(remove-item|ri|rm|del)\b[^;|&\n]*\s-r(e(c(u(r(s(e)?)?)?)?)?)?\b/i,
  /\b(rd|rmdir)\b[^;|&\n]*\s\/s\b/i,
  /\bgit\b[^;|&\n]*\bpush\b[^;|&\n]*(\s-f\b|\s--force|\s\+|\s--mirror|\s--delete)/,
  /\bgit\b[^;|&\n]*\breset\b[^;|&\n]*\s--hard\b/,
]

export async function rateCommand(command: string, ctx: Context, from: string | undefined = ctx.root, depth = 0): Promise<Rating> {
  const segments = tokenize(command)
  if (segments === undefined) {
    if (mentionsCredential(command)) return rated(3, 'touches a credential file')
    if (DESTRUCTIVE_TEXT.some(re => re.test(command))) return rated(3, 'a command it cannot parse holds a destructive part')
    return rated(2, 'command could not be parsed')
  }
  const ratings: Rating[] = []
  let base: string | undefined = from
  for (const seg of segments) {
    const head = seg.words[0]?.text.toLowerCase()
    if (head && CD_COMMANDS.has(head)) {
      const target = seg.words.slice(1).find(w => !isFlag(w))?.text
      base = target === undefined || target === '-' || head.startsWith('pop') || hasExpansion(target) ? undefined : await ctx.place(target, base)
      continue
    }
    if (base === undefined) {
      ratings.push(rated(2, 'runs in a folder it cannot place'))
      const r = await rateSegment(seg, undefined, ctx, depth)
      ratings.push(r.tier === 3 ? r : rated(Math.max(r.tier, 2) as Tier, r.reason))
      continue
    }
    ratings.push(await rateSegment(seg, base, ctx, depth))
  }
  return highest(ratings)
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

export async function rateCall(tool: string, input: unknown, ctx: Context): Promise<Rating> {
  const i = (input ?? {}) as Record<string, unknown>
  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = str(i.command)
    if (command === undefined) return rated(2, `${tool} without a command`)
    return rateCommand(command, ctx)
  }
  if (tool === 'Read' || tool === 'NotebookRead') return ratePath(str(i.file_path) ?? str(i.notebook_path), ctx.root, ctx, false)
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const p = str(i.file_path) ?? str(i.notebook_path)
    if (p === undefined) return rated(2, `${tool} without a path`)
    return ratePath(p, ctx.root, ctx, true)
  }
  if (tool === 'Glob' || tool === 'Grep') {
    for (const key of ['pattern', 'glob']) {
      const v = str(i[key])
      if (v !== undefined && mentionsCredential(v) && (tool === 'Glob' || key === 'glob')) return rated(3, `searches credential files: ${v}`)
    }
    return ratePath(str(i.path), ctx.root, ctx, false)
  }
  if (NETWORK_TOOLS.has(tool)) return rated(2, `${tool} reaches the network`)
  if (tool === 'Agent' || tool === 'Task') return rated(2, 'a subagent can do anything its tools allow; its calls are rated one by one')
  if (tool.startsWith('mcp__')) return rated(2, `MCP tool ${tool}: its reach is the server's`)
  if (HARMLESS_TOOLS.has(tool)) return rated(0, `${tool} changes no file`)
  return rated(2, `unknown tool ${tool}`)
}
