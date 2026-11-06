import { expect, test } from 'claude-code/testing'

type On = Parameters<Parameters<typeof test>[1]>[1]

function git(on: On, answers: { branch: [number, string]; status?: [number, string, string?] }) {
  on('process.run', (_, e) => {
    const sub = e.argv.slice(1).join(' ')
    if (sub === 'rev-parse --abbrev-ref HEAD') {
      const [exitCode, stdout] = answers.branch
      return { value: { exitCode, stdout, stderr: exitCode ? 'fatal: not a git repository' : '' } }
    }
    if (sub === 'status --porcelain' && answers.status) {
      const [exitCode, stdout, stderr = ''] = answers.status
      return { value: { exitCode, stdout, stderr } }
    }
    throw new Error(`unexpected command: ${e.argv.join(' ')}`)
  })
}

function statusLine(on: On) {
  const lines: (string | undefined)[] = []
  on('ui.status', (_, e) => {
    lines.push(e.text)
    return { value: undefined }
  })
  return lines
}

const start = { cwd: '/work/proj', surface: 'terminal', isInteractive: true } as const

test('shows the branch and the count of uncommitted files at session start', async ($, on) => {
  git(on, { branch: [0, 'main\n'], status: [0, ' M a.txt\n?? b.txt\n'] })
  const lines = statusLine(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start(start)
  expect(lines.at(-1)).toBe('main · 2 uncommitted')
})

test('says clean when nothing is uncommitted', async ($, on) => {
  git(on, { branch: [0, 'feature/x\n'], status: [0, ''] })
  const lines = statusLine(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start(start)
  expect(lines.at(-1)).toBe('feature/x · clean')
})

test('clears the line outside a git repository', async ($, on) => {
  git(on, { branch: [128, ''] })
  const lines = statusLine(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start(start)
  expect(lines.at(-1)).toBeUndefined()
})

test('shows the error when git cannot run', async ($, on) => {
  on('process.run', () => {
    throw new Error('git not found')
  })
  const lines = statusLine(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start(start)
  expect(lines.at(-1)).toMatch(/^git: ./)
})

test('refreshes after a tool call that can change files', async ($, on) => {
  git(on, { branch: [0, 'main\n'], status: [0, ' M a.txt\n'] })
  const lines = statusLine(on)
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'Bash', command: 'echo x > a.txt' })
  expect(lines.at(-1)).toBe('main · 1 uncommitted')
})

test('does not run git after a read-only tool call', async ($, on) => {
  git(on, { branch: [0, 'main\n'], status: [0, ''] })
  const lines = statusLine(on)
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'Read', file_path: '/work/proj/a.txt' })
  expect(lines).toEqual([])
})
