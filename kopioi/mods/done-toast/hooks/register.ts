import type { Register } from 'claude-code'

export const LONG_TURN_MS = 60_000
export const LONG_TESTS_MS = 10_000

const TEST_COMMAND = /\b(pytest|Invoke-Pester|npm (run )?test|pnpm test|yarn test|go test|cargo test|dotnet test|mvn test|gradle test|jest|vitest|claude plugin test)\b/i

const seconds = (ms: number) => {
  const s = Math.round(ms / 1000)
  return s < 120 ? `${s} s` : `${Math.round(s / 60)} min`
}

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!e.isAborted && e.durationMs >= LONG_TURN_MS) $.ui.toast(`Claude finished after ${seconds(e.durationMs)}`)
    return done
  })

  on('tool.call', async ($, e, next) => {
    const command = e.tool === 'Bash' || String(e.tool) === 'PowerShell' ? String((e as { command?: unknown }).command ?? '') : ''
    if (!TEST_COMMAND.test(command)) return next(e)
    const startedAt = await $.clock.now()
    const ran = await next(e)
    const took = (await $.clock.now()) - startedAt
    if (ran.deny === undefined && took >= LONG_TESTS_MS) {
      $.ui.toast(`Tests ${ran.isError ? 'failed' : 'finished'} after ${seconds(took)}`)
    }
    return ran
  })
}
