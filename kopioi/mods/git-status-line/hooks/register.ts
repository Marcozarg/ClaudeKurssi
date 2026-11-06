import type { EngineInterface, Register } from 'claude-code'

const CHANGING_TOOLS = new Set(['Bash', 'PowerShell', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

export async function gitLine($: EngineInterface): Promise<string | undefined> {
  const branch = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch.exitCode !== 0) return undefined
  const status = await $.process.run(['git', 'status', '--porcelain'])
  if (status.exitCode !== 0) return `git: ${status.stderr.trim() || 'status failed'}`
  const count = status.stdout.split('\n').filter(line => line.trim() !== '').length
  const name = branch.stdout.trim()
  return `${name === 'HEAD' ? 'detached HEAD' : name} · ${count === 0 ? 'clean' : `${count} uncommitted`}`
}

async function refresh($: EngineInterface) {
  const line = await gitLine($).catch(err => `git: ${err instanceof Error ? err.message : String(err)}`)
  $.ui.status(line)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await refresh($)
    return started
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (CHANGING_TOOLS.has(String(e.tool))) await refresh($)
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refresh($)
    return done
  })
}
