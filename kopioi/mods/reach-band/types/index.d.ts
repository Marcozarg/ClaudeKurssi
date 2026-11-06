export type BandRow = { tool: string; tier: 0 | 1 | 2 | 3; reason: string }

declare module 'claude-code' {
  interface PluginState {
    'reach-band': { last: BandRow | null }
  }
}
