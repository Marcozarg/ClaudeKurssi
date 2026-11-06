import { expect, mock, test } from 'claude-code/testing'

type On = Parameters<Parameters<typeof test>[1]>[1]

function toasts(on: On) {
  const shown: string[] = []
  on('ui.toast', (_, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  return shown
}

const turn = (durationMs: number, isAborted = false) =>
  ({ answer: 'done', durationMs, isAborted, turnId: 't1', reason: isAborted ? 'aborted' : 'answer' }) as never

test('a long turn ends with a toast', async ($, on) => {
  const shown = toasts(on)
  on('turn.complete', () => ({ text: 'done' }) as never)
  await $.turn.complete(turn(185_000))
  expect(shown).toEqual(['Claude finished after 3 min'])
})

test('a short turn and an aborted turn show nothing', async ($, on) => {
  const shown = toasts(on)
  on('turn.complete', () => ({ text: 'done' }) as never)
  await $.turn.complete(turn(20_000))
  await $.turn.complete(turn(300_000, true))
  expect(shown).toEqual([])
})

test('a long test run shows whether it passed or failed', async ($, on) => {
  const clock = mock.clock(on)
  const shown = toasts(on)
  let isError = false
  on('tool.call', async () => {
    await clock.advance(42_000)
    return (isError ? { isError: true, result: 'exit code 1', text: 'exit code 1' } : { result: {} }) as never
  })
  await $.tool.call({ tool: 'Bash', command: 'python -m pytest tests' })
  isError = true
  await $.tool.call({ tool: 'Bash', command: 'Invoke-Pester' })
  expect(shown).toEqual(['Tests finished after 42 s', 'Tests failed after 42 s'])
})

test('a quick test run and a long non-test command show nothing', async ($, on) => {
  const clock = mock.clock(on)
  const shown = toasts(on)
  let step = 0
  on('tool.call', async () => {
    await clock.advance([2_000, 90_000][step++] ?? 0)
    return { result: {} } as never
  })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Bash', command: 'npm run build' })
  expect(shown).toEqual([])
})
