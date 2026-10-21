# Pre-game screens in the tavern: brief

The user: the home page "is not doing justice to what's inside". The blocky (Minecraft-like) Nepali characters
are fun; lean into that. Home, join ("connecting"), loading, errors and the lobby ("admin screen before you
play") look like a different app from the game. They must look like what's inside: the 3D tavern, the frosted
glass panels, the characters.

## Direction (decided)

- **One tavern behind everything before the game.** A shared live 3D backdrop (`src/ui/tavern/`) renders the
  same room as the game (lamp, wood, table, plate, chairs, Nepali villagers from `src/ui/table/three/`). It is
  lazy-loaded; until it is ready (and without WebGL) the page shows a warm dark CSS tavern gradient, so the UI
  is usable immediately.
- **Home:** the camera slowly circles the table (stops under reduced motion). Drag anywhere on the scene to spin
  around. Tap a villager and they react (cheer, nod, flinch...) with a sound. One villager is **you**: dressed in
  the colour you pick, with the look your name suggests, marked by a small bobbing gem above the head; it
  updates live as you type and pick. The controls sit in one frosted-glass panel (left on desktop, docked at the
  bottom on phones): the title, name + colour, Start, join by code, recent tables.
- **Title:** blocky pixel display font (Pixelify Sans) with a voxel-style extrusion in brass, and the
  Devanagari name (अकबरे पानीपुरी, Rozha One) under it.
- **Join / loading / errors:** the same circling tavern behind one glass card.
- **Lobby:** the actual table from your seat, with the game's camera, so Start simply deals the cards. Every
  player and bot sits at the table as they join (a new seat pops in), with name tags above their heads. Glass
  panels: code tiles + copy link, the player list with host controls (+ bot, remove), presets, Start /
  waiting.
- **Rules page:** the same dark glass theme.

## Must keep

All behaviour, routes, forms, validation, accessibility (labels, focus, 44px targets on phones, keyboard),
toasts, local-mode badge, recent games, host-only controls, presence dots, "take seat" for a botted seat, the
leave dialog. Minimal UI: no new explanatory text beyond a tiny "Drag to look around" hint that fades.
Phones: no horizontal scroll, the form stays usable with the on-screen keyboard. Performance: the 3D backdrop
is one lazy chunk shared with the game, DPR clamped, no shadows on phones, paused when the tab is hidden.
