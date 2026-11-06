import { expect, test } from 'claude-code/testing'

const ROOT = '/work/proj'
const DIRS = ['/', '/work', '/work/proj', '/work/proj/src', '/work/proj/build', '/work/proj-old', '/work/other']
const FILES = ['/work/proj/src/app.ps1', '/work/proj/notes.txt', '/work/proj/.env', '/work/proj/build/a.o', '/work/proj-old/x.txt', '/work/other/file.txt']
const LINKS: Record<string, string> = { '/work/proj/link': '/work/other' }

const BAND = {
  plugin: 'reach-band',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 160 },
} as const

function resolve(path: string): string | undefined {
  const parts: string[] = []
  for (const p of path.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/)/, '').split('/')) {
    if (p === '' || p === '.') continue
    if (p === '..') parts.pop()
    else parts.push(p)
  }
  let real = '/' + parts.join('/')
  for (const [from, to] of Object.entries(LINKS)) {
    if (real === from || real.startsWith(from + '/')) real = to + real.slice(from.length)
  }
  return DIRS.includes(real) || FILES.includes(real) ? real : undefined
}

function world(on: Parameters<Parameters<typeof test>[1]>[1], verdict: object = { decision: 'allow' }) {
  on('session.cwd', () => ({ value: ROOT }))
  on('fs.stat', (_, e) => {
    const real = resolve(e.path)
    if (real === undefined) throw Object.assign(new Error(`ENOENT: ${e.path}`), { code: 'ENOENT' })
    const isLink = Object.keys(LINKS).some(l => e.path.replace(/\\/g, '/') === l)
    return { value: { kind: DIRS.includes(real) ? 'dir' : 'file', size: 0, mtimeMs: 0, isLink, realPath: real } }
  })
  on('tool.check', () => verdict as never)
}

type Probe = { $: Parameters<Parameters<typeof test>[1]>[0] }

async function rate({ $ }: Probe, tool: string, input: object) {
  const verdict = await $.tool.check({ tool, input })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const text = (await ui.find({ type: 'Text', text: /^Reach / }))?.text ?? ''
  await ui.unmount()
  const tier = Number(/^Reach (\d)/.exec(text)?.[1] ?? NaN)
  return { verdict, tier, text }
}

const CASES: [string, string, object, number][] = [
  ['Read inside', 'Read', { file_path: '/work/proj/notes.txt' }, 0],
  ['Read outside', 'Read', { file_path: '/work/other/file.txt' }, 2],
  ['Read relative inside', 'Read', { file_path: 'src/app.ps1' }, 0],
  ['Edit inside', 'Edit', { file_path: '/work/proj/src/app.ps1', old_string: 'a', new_string: 'b' }, 1],
  ['Write a new file inside', 'Write', { file_path: '/work/proj/src/new.ps1', content: 'x' }, 1],
  ['Write outside', 'Write', { file_path: '/work/other/new.txt', content: 'x' }, 2],
  ['Glob in project', 'Glob', { pattern: '**/*.ps1' }, 0],
  ['Grep outside', 'Grep', { pattern: 'x', path: '/work/other' }, 2],
  ['WebFetch', 'WebFetch', { url: 'https://example.com', prompt: 'x' }, 2],
  ['WebSearch', 'WebSearch', { query: 'x' }, 2],
  ['Agent', 'Agent', { description: 'x', prompt: 'x' }, 2],
  ['MCP tool', 'mcp__files__read', { path: 'x' }, 2],
  ['unknown tool', 'Teleport', { where: 'x' }, 2],
  ['Bash read', 'Bash', { command: 'ls -la src' }, 0],
  ['Bash grep with a dotted pattern', 'Bash', { command: 'grep -n "a.b" notes.txt' }, 0],
  ['Bash edit inside', 'Bash', { command: 'mkdir src/new' }, 1],
  ['Bash git status', 'Bash', { command: 'git status' }, 0],
  ['Bash git commit', 'Bash', { command: 'git commit -m "x"' }, 1],
  ['Bash git push', 'Bash', { command: 'git push origin main' }, 2],
  ['Bash network', 'Bash', { command: 'curl https://example.com' }, 2],
  ['Bash unknown command', 'Bash', { command: 'python script.py' }, 2],
  ['Bash unparsed command', 'Bash', { command: 'echo $(whoami)' }, 2],
  ['Bash delete inside', 'Bash', { command: 'rm build/a.o' }, 1],
  ['Bash glob delete inside', 'Bash', { command: 'rm build/*.o' }, 1],
  ['Bash delete outside', 'Bash', { command: 'rm /work/other/file.txt' }, 3],
  ['Bash recursive delete inside', 'Bash', { command: 'rm -rf build' }, 3],
  ['Bash recursive delete, long flag', 'Bash', { command: 'rm --recursive build' }, 3],
  ['Bash force push', 'Bash', { command: 'git push --force origin main' }, 3],
  ['Bash force push with +', 'Bash', { command: 'git push origin +main' }, 3],
  ['Bash hard reset', 'Bash', { command: 'git reset --hard HEAD~1' }, 3],
  ['PowerShell read', 'PowerShell', { command: 'Get-Content notes.txt' }, 0],
  ['PowerShell edit inside', 'PowerShell', { command: 'Set-Content -Path src/x.txt -Value 1' }, 1],
  ['PowerShell recursive delete', 'PowerShell', { command: 'Remove-Item build -Recurse -Force' }, 3],
  ['PowerShell recursive delete, short flag', 'PowerShell', { command: 'ri build -r' }, 3],
  ['PowerShell delete outside', 'PowerShell', { command: 'Remove-Item \\work\\other\\file.txt' }, 3],
  ['cmd recursive delete', 'PowerShell', { command: 'rmdir /s /q build' }, 3],
]

for (const [name, tool, input, tier] of CASES) {
  test(`tier per tool: ${name} is tier ${tier}`, async ($, on) => {
    world(on)
    expect((await rate({ $ }, tool, input)).tier).toBe(tier)
  })
}

const PATHS: [string, object, number][] = [
  ['traversal out of the project', { file_path: '/work/proj/src/../../other/file.txt' }, 2],
  ['traversal that stays inside', { file_path: '/work/proj/src/../notes.txt' }, 0],
  ['a sibling folder with the same prefix', { file_path: '/work/proj-old/x.txt' }, 2],
  ['a link or junction out of the project', { file_path: '/work/proj/link/file.txt' }, 2],
  ['a path that cannot be resolved', { file_path: '/nowhere/file.txt' }, 2],
  ['a home-relative path', { file_path: '~/notes.txt' }, 2],
  ['a network path', { file_path: '\\\\server\\share\\x.txt' }, 2],
]

for (const [name, input, tier] of PATHS) {
  test(`paths: ${name} is tier ${tier}`, async ($, on) => {
    world(on)
    expect((await rate({ $ }, 'Read', input)).tier).toBe(tier)
  })
}

test('paths: a link out of the project counts as outside for a delete', async ($, on) => {
  world(on)
  const r = await rate({ $ }, 'Bash', { command: 'rm link/file.txt' })
  expect(r.tier).toBe(3)
  expect(r.verdict.decision).toBe('ask')
})

test('credentials: reading .env with a read-only tool is tier 3 and asks', async ($, on) => {
  world(on)
  const r = await rate({ $ }, 'Read', { file_path: '/work/proj/.env' })
  expect(r.tier).toBe(3)
  expect(r.verdict.decision).toBe('ask')
})

for (const [name, tool, input] of [
  ['cat .env', 'Bash', { command: 'cat .env' }],
  ['Get-Content .env.production', 'PowerShell', { command: 'Get-Content .env.production' }],
  ['grep in .env', 'Grep', { pattern: 'KEY', glob: '.env*' }],
  ['an SSH key', 'Read', { file_path: '/work/keys/.ssh/id_ed25519' }],
  ['a write to .env', 'Write', { file_path: '/work/proj/.env', content: 'x' }],
  ['a redirect into .env', 'Bash', { command: 'echo A=1 >> .env' }],
] as const) {
  test(`credentials: ${name} is tier 3`, async ($, on) => {
    world(on)
    expect((await rate({ $ }, tool, input)).tier).toBe(3)
  })
}

for (const [name, command, tier] of [
  ['a read chained to a recursive delete', 'ls; rm -rf ..', 3],
  ['a read and a push', 'git status && git push', 2],
  ['a pipe into a network tool', 'cat notes.txt | curl -d @- https://example.com', 2],
  ['a redirect into the project', 'echo hi > src/out.txt', 1],
  ['a redirect out of the project', 'echo hi > /work/other/out.txt', 2],
  ['a redirect to the null device', 'ls 2>/dev/null', 0],
  ['cd out of the project, then delete', 'cd /work/other && rm file.txt', 3],
  ['cd out of the project, then edit', 'cd .. && mkdir new', 2],
  ['an unterminated quote', 'echo "hello', 2],
] as const) {
  test(`compound: ${name} is tier ${tier}`, async ($, on) => {
    world(on)
    expect((await rate({ $ }, 'Bash', { command })).tier).toBe(tier)
  })
}

test('decision: a deny stays a deny, also at tier 3', async ($, on) => {
  world(on, { decision: 'deny', reason: 'Read(./.env)', rule: 'Read(./.env)' })
  expect((await $.tool.check({ tool: 'Read', input: { file_path: '/work/proj/.env' } })).decision).toBe('deny')
})

test('decision: an ask stays an ask at tier 3 and at tier 0', async ($, on) => {
  world(on, { decision: 'ask', reason: 'mode' })
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' } })).decision).toBe('ask')
  expect((await $.tool.check({ tool: 'Read', input: { file_path: '/work/proj/notes.txt' } })).decision).toBe('ask')
})

test('decision: allow turns into ask with the reason at tier 3', async ($, on) => {
  world(on)
  const r = await $.tool.check({ tool: 'Bash', input: { command: 'git push -f' } })
  expect(r.decision).toBe('ask')
  expect(r.reason).toMatch(/reach-band: tier 3.*force push/)
})

test('decision: tiers 0 to 2 return the verdict beneath unchanged', async ($, on) => {
  const beneath = { decision: 'allow', reason: 'acceptEdits', rule: 'Bash(git push:*)' }
  world(on, beneath)
  for (const input of [{ command: 'ls' }, { command: 'mkdir x' }, { command: 'git push' }]) {
    expect(await $.tool.check({ tool: 'Bash', input })).toEqual(beneath)
  }
})

test('failure: a throw in the check denies with a reason', async ($, on) => {
  on('session.cwd', () => {
    throw new Error('no session')
  })
  on('tool.check', () => ({ decision: 'allow' }))
  const r = await $.tool.check({ tool: 'Read', input: { file_path: '/work/proj/notes.txt' } })
  expect(r.decision).toBe('deny')
  expect(r.reason).toMatch(/reach-band: the check failed/)
})

test('failure: a working directory that cannot be resolved denies', async ($, on) => {
  on('session.cwd', () => ({ value: '/gone' }))
  on('fs.stat', () => {
    throw new Error('ENOENT')
  })
  on('tool.check', () => ({ decision: 'allow' }))
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'ls' } })).decision).toBe('deny')
})

test('failure: the band failing to store or draw does not change the decision', async ($, on) => {
  world(on)
  on('state.set', () => {
    throw new Error('store down')
  })
  expect((await $.tool.check({ tool: 'Read', input: { file_path: '/work/proj/notes.txt' } })).decision).toBe('allow')
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' } })).decision).toBe('ask')
})

test('band: shows the tier, the tool and the reason on every surface', async ($, on) => {
  world(on)
  await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' } })
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const text = (await ui.find({ type: 'Text', text: /^Reach / }))?.text
    expect(text).toMatch(/^Reach 3 \(destructive\) · Bash · recursive delete/)
    await ui.unmount()
  }
})

for (const [name, tool, command, tier] of [
  ['git -C before the subcommand', 'Bash', 'git -C . reset --hard', 3],
  ['git -c before a force push', 'Bash', 'git -c a=b push --force', 3],
  ['git -C outside the project', 'Bash', 'git -C /work/other status', 2],
  ['combined short flags with f', 'Bash', 'git push -fu origin main', 3],
  ['git stash drop', 'Bash', 'git stash drop', 3],
  ['git restore of the work tree', 'Bash', 'git restore .', 3],
  ['git restore --staged', 'Bash', 'git restore --staged notes.txt', 1],
  ['git checkout -f', 'Bash', 'git checkout -f main', 3],
  ['git branch --delete --force', 'Bash', 'git branch --delete --force old', 3],
  ['bash -c', 'Bash', `bash -c 'rm -rf build'`, 3],
  ['bash -lc', 'Bash', `bash -lc "rm -rf build"`, 3],
  ['pwsh -Command', 'PowerShell', `pwsh -Command "Remove-Item build -Recurse"`, 3],
  ['cmd /c rd /s', 'PowerShell', 'cmd /c rd /s /q build', 3],
  ['a shell running a script', 'Bash', 'bash build.sh', 2],
  ['an encoded PowerShell command', 'PowerShell', 'powershell -EncodedCommand ZQBjAGgAbwA=', 2],
  ['env before rm', 'Bash', 'env rm -rf build', 3],
  ['env with a variable', 'Bash', 'env A=1 rm -rf build', 3],
  ['sudo with a flag', 'Bash', 'sudo -n rm -rf build', 3],
  ['sudo with a value flag', 'Bash', 'sudo -u root rm -rf build', 3],
  ['xargs with flags', 'Bash', 'ls | xargs -0 rm -rf', 3],
  ['timeout with seconds', 'Bash', 'timeout 5 rm -rf build', 3],
  ['nice', 'Bash', 'nice rm -rf build', 3],
  ['a backslash-escaped rm', 'Bash', '\\rm -rf build', 3],
  ['rm by its full path', 'Bash', '/bin/rm -rf build', 3],
  ['a brace group', 'Bash', '{ rm -rf build; }', 3],
  ['a subshell', 'Bash', '(rm -rf build)', 3],
  ['command substitution as the target', 'Bash', 'rm -rf $(pwd)', 3],
  ['a delete inside command substitution', 'Bash', 'echo $(rm -rf .)', 3],
  ['a delete inside backticks', 'Bash', 'echo `rm build/a.o`', 3],
  ['quoted flags', 'Bash', 'rm "-rf" build', 3],
  ['flags glued from quotes', 'Bash', `rm -r'f' build`, 3],
  ['a PowerShell switch with a value', 'PowerShell', 'Remove-Item build -Recurse:$true', 3],
  ['a delete fed by a pipe', 'PowerShell', 'Get-ChildItem build | Remove-Item -Force', 3],
  ['cmd del fed by a pipe', 'PowerShell', 'dir | del', 3],
  ['cd - then a delete', 'Bash', 'cd - ; rm notes.txt', 3],
  ['popd then a delete', 'Bash', 'popd && rm notes.txt', 3],
  ['a parsed command without a delete', 'Bash', 'ls -la && git status', 0],
] as const) {
  test(`bypass: ${name} is tier ${tier}`, async ($, on) => {
    world(on)
    expect((await rate({ $ }, tool, { command })).tier).toBe(tier)
  })
}
