# Third-party assets

| Asset | Where | Source | Licence |
| --- | --- | --- | --- |
| Six seated characters (`character-female-a/c/f`, `character-male-a/b/e`) and their palette texture | `public/models/characters/` | Kenney, "Mini Characters" 1.0, https://kenney.nl/assets/mini-characters | CC0 1.0 (public domain), see `public/models/characters/LICENSE-kenney.txt` |

Everything else in the 3D room (wood grain, table, plate, lamp, chairs, card faces) is generated in code
(`src/ui/table/three/textures.ts`, `Room.tsx`) from the game's own card art. Shirts are recoloured per player at
runtime (`characters.ts`), so the files stay as downloaded.
