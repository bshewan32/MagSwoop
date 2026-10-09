# MagSwoop: Magpie Sky Patrol

A 3D arcade browser game built with three.js. It is swooping season in an Australian suburban park.
You control a flock of three magpies and defend the nest by diving at runners and cyclists. You score
points for scaring them off or hitting them, keep combos going, and switch birds before the one you are
flying gets too tired.

```bash
pnpm install
pnpm dev      # local dev server
pnpm build    # production build + sharing metadata + bundle budget
pnpm test     # unit tests (rules, flight, park layout, songs, save, i18n, tuning)
pnpm smoke    # after build: headless playthrough (fly, swoop, carol, switch, menus) + shots/
```

## How to play

| Action | Keyboard / mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Steer / climb / dive | WASD or arrows, or the mouse (click to capture) | Left stick | Left drag pad |
| Flap | Space | A | (automatic) |
| Boost | Shift | RB / LT | BOOST |
| Swoop at the locked target | F or left click | X / RT | SWOOP |
| Carol (scares score x1.5 for a few seconds) | E | Y | CAROL |
| Switch magpie | Q, or 1 / 2 / 3 | LB | SWITCH |
| Pause | Esc or P | Start | Pause button |

- **Scare** a person by swooping close past them. **Hit** them for more points. Chained swoops build a combo.
- **Intruders** walk into the red ring around the nest tree. If they get through, you lose one of the three
  eggs. Chase them off for a "Nest defended" bonus.
- Each magpie has **stamina**. Resting birds perch, recover, and carol on their own.
- The season lasts 2:30. Every egg you still have at the end adds a bonus. Your best scores are saved locally.

## The flock

| Magpie | Plumage | Handling | Voice |
| --- | --- | --- | --- |
| **Pied** | White-backed | Balanced all-rounder | Clear, sweet carol |
| **Scruffy** | Mottled grey-brown juvenile | Nimble with the most stamina | Higher, scratchy warble |
| **Blackback** | Mostly black | Fastest dives, biggest hits | Deep, rich song |

## Audio (all synthesised live with Web Audio, no recordings)

- **Magpie carols**: multi-phrase, two-voice warbling songs with per-bird pitch, timbre and tempo.
  The call button plays them, and resting birds also sing them from their perches.
- **Alarm calls and chortles** play when a magpie swoops, scores a hit, or spots an intruder.
- **Swoop whoosh** is filtered noise that follows the bird's dive speed. It is layered with wind rush,
  wing flaps and bill clacks.
- **People and park sounds**: bike bells, yelps and ambient park birdsong.
- There are three volume buses: **Magpie calls**, **Effects** and **Ambience**. You can also mute
  everything in Settings.

## Layout

| Path | Role |
| --- | --- |
| `src/game/park.ts` | Pure park layout: bike loop, gravel paths, trees, furniture, nest and perches |
| `src/game/config.ts` / `tuning.ts` | Flight, swoop, carol, crowd, scoring and camera tuning |
| `src/game/rules.ts` | Pure scoring, combos, carol buff, eggs, timer and stars (unit tested) |
| `src/game/magpies.ts` | Three plumage variants and the procedural low-poly magpie model |
| `src/game/bird.ts` | Flight controller: flapping, boost, homing swoops, stamina, AI perching |
| `src/game/people.ts` | Procedural runners and cyclists with path following, startle and flee |
| `src/game/world.ts` | Procedural suburban park scene: sky, gum trees, houses, fence and nest tree |
| `src/game/game.ts` | Orchestrator: flock switching, targeting, scoring, nest defence and audio cues |
| `src/engine/audio.ts` | Magpie song synthesiser and sound-effect engine |
| `src/ui/ui.ts`, `src/ui/touch.ts`, `src/styles/main.css` | DOM menus, HUD, results, high scores and touch controls |
| `src/i18n/en.json` | All player-facing text |
| `game-sharing.json`, `assets/share/` | Share card metadata, cover art and favicon |

## Rules for changes

- **Simulation in `step()`, visuals in `render()`/`animate()`.** Read presses in fixed steps with
  `input.consume(action)`.
- **Rules stay pure.** Scoring and win/lose logic live in `rules.ts` with tests.
- **Every visible string is an i18n key** in `src/i18n/en.json`. A test checks that every key used in code exists.
- Keep `pnpm build` within budget (`scripts/check-size.mjs`) and `pnpm smoke` green.

Online features (accounts, online leaderboards and multiplayer) are not part of this version. The game runs without a server.

## Credits

Fonts: ManusCC0 (regular, medium, bold), CC0 1.0. See `public/fonts/ManusCC0-LICENSE.txt`.
Library: three.js (MIT). All 3D models are procedural, and all sounds are synthesised at runtime.

## Preview Tweak

`src/game/tuning.ts` is this game's parameter manager. The Addon panel reads its
catalog; `config.ts` owns source defaults and the active configuration used by gameplay.
When adapting the game, keep only controls with actual gameplay consumers, and preserve
stable IDs for unchanged parameters. Define ranges, units and the correct activation
boundary. Register through `scripts/manus-tuning/adapter.js` only under `import.meta.env.DEV`.
Keep the Vite plugin and `scripts/__manus__/` helpers intact; production builds exclude
the browser adapter and never inject the bridge.

Apply changes preview state only. `LIVE` parameters are read in the next game update;
`NEXT_ACTION` parameters activate at the next swoop start; `NEXT_RUN` parameters
activate in `Game.start`. Model sizes and the park layout are not exposed by this version.
Do not mutate the source defaults or persist Apply to localStorage. Save with Manus
checks the snapshot against the current catalog and edits `DEFAULT_CONFIG`, then uses
the normal Three.js Web build/checkpoint workflow. Keep existing gameplay parameter
managers when extending an older project; do not create a competing store.

For server-authoritative multiplayer, expose local cosmetic controls only until gameplay
parameters have explicit server-side development support. The descriptor's GAMEPLAY flag
is a classification, not server authorization or ranked-score enforcement.

The preview plugin reads the ignored `.manus-webdev/preview-identity.json` v1 projection
written by the Runtime when initializing, attaching or restoring this project. It contains
only the resource ID and canonical project directory; private Host bindings and starter
receipts are not template dependencies. Missing identity disables the bridge.
The manager latches `tuning.unranked` when non-default GAMEPLAY values become active and
resets it only at the next run using that run's active values. `Game` snapshots this onto
`RunState.unranked`; local results cannot save such runs. Preserve this guard when changing
scoring. When adding online leaderboards, skip submissions for unranked runs and enforce
eligibility in the authoritative server too; client flags are not proof of a fair score.
