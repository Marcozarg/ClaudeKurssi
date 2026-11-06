import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BandRow } from '../types'
import { rateCall, TIER_NAMES } from './rate'
import type { Context } from './rate'

const last = atom({ plugin: 'reach-band', key: 'last' } as const, null)

const isAbsolute = (p: string) => /^[A-Za-z]:[\\/]/.test(p) || /^[\\/]/.test(p)

const realPathOf = async ($: EngineInterface, path: string) =>
  (await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath

async function place($: EngineInterface, path: string, base: string | undefined): Promise<string | undefined> {
  if (!isAbsolute(path) && base === undefined) return undefined
  const full = isAbsolute(path) ? path : `${base!.replace(/[\\/]$/, '')}/${path}`
  const cut = Math.max(full.lastIndexOf('/'), full.lastIndexOf('\\'))
  const name = full.slice(cut + 1)
  const isPlaceable = !/^[A-Za-z]:(?![\\/])/.test(full) && !/^[\\/][\\/]/.test(full) && !/^[A-Za-z]:/.test(name)
  if (!isPlaceable) return undefined
  const own = await realPathOf($, full)
  if (own !== undefined) return own
  if (name === '' || name === '.' || name === '..') return undefined
  const folder = await realPathOf($, full.slice(0, cut + 1))
  return folder === undefined ? undefined : `${folder.replace(/[\\/]$/, '')}/${name}`
}

async function context($: EngineInterface): Promise<Context> {
  const cwd = await $.session.cwd()
  const root = await realPathOf($, cwd)
  if (root === undefined) throw new Error(`the working directory ${cwd} cannot be resolved`)
  return { root, place: (path, base) => place($, path, base) }
}

export const register: Register = on => {
  on('tool.check', async ($, e, next) => {
    const decided = await next(e)
    const rating = await rateCall(e.tool, e.input, await context($))
    const row: BandRow = { tool: e.tool, tier: rating.tier, reason: rating.reason }
    update($, last, () => row).catch(err => $.ui.log(`reach-band: band not updated: ${String(err)}`))
    if (rating.tier === 3 && decided.decision === 'allow') {
      return { decision: 'ask', reason: `reach-band: tier 3 (${TIER_NAMES[3]}): ${rating.reason}` }
    }
    return decided
  }).catch(($, e, next) => ({
    decision: 'deny',
    reason: `reach-band: the check failed (${next.error.kind}${next.error.message ? `: ${next.error.message}` : ''}), so the call is refused`,
  }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const row = await read($, last)
    if (row === null || e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text>
          Reach {row.tier} ({TIER_NAMES[row.tier]}) · {row.tool} · {row.reason}
        </Text>
      </Box>
    )
  })
}
