export type Limit = { kind: string; pct: number; resetsAt?: string }

export type Snapshot = {
  ctxPct: number
  ctxTokens?: number
  ctxWindow: number
  limits: Limit[]
  usd?: number
}

/** `prev` is what the gauges sweep from; it catches up to `cur` once the sweep ends. */
export type Gauges = { cur: Snapshot | null; prev: Snapshot | null }

declare module 'claude-code' {
  interface PluginState {
    'usage-hud': { gauges: Gauges; isHidden: boolean }
  }
}
