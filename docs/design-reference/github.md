repo: yashantgyawali/akabare-panipuri
branch: main

## Last sync
date: 2026-10-06T11:11:12Z

### Updated in this project
- Full redesign in the Tumlet design system (beige, hard shadows, minimal layout)
- Rules engine + bots ported to engine.js so the prototype plays end to end
- Card art and backs copied from public/art and public/backs

## Screen map
| Screen | Repo files |
|---|---|
| Home | src/ui/home/Home.tsx |
| Lobby | src/ui/game/Lobby.tsx |
| Table (seats, dock, HUD) | src/ui/table/Table.tsx, Panels.tsx, SetupPanel.tsx, EatingHud.tsx, Chrome.tsx |
| Bite / result / game over | src/ui/table/Overlays.tsx |
| Rules | src/ui/rules/Rules.tsx, src/cards/content.ts |
| Cards (PuriCard.dc.html) | src/cards/Card.tsx, src/cards/palette.ts |
| engine.js | src/engine/engine.ts, rules.ts, bot.ts |
