/**
 * Public engine API. Everything outside src/engine imports from here.
 *
 *   createGame(players, config, seed)   → GameState (round 1 setup; throws EngineError on invalid input)
 *   applyAction(state, playerId, action) → ApplyResult (pure; never mutates `state`)
 *   setBot(state, playerId, isBot)       → GameState (host replaces an absent player with a bot, or a player reclaims)
 *   runBots(state, maxSteps?)            → { state, events } (applies bot moves until a human must act or game over)
 *   chooseBotAction(state, botId)        → Action | null (decides ONLY from projectView(state, botId))
 *   pendingActors(state)                 → PlayerId[] (who the game is waiting on)
 *   legalActions(state, playerId)        → LegalActions
 *   projectView(state, playerId | null)  → PlayerView (the ONLY thing ever sent to clients)
 *   resolveConfig(partial)               → GameConfig (defaults applied)
 *   validateConfig(config)               → string[] (human-readable errors; empty = valid)
 *   availablePowers(state, playerId)     → PowerKind[]
 */
export * from './types.ts';
export * from './rules.ts';
export * from './engine.ts';
export * from './view.ts';
export * from './bot.ts';
