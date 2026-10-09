# MagSwoop — Implementation Plan

## Product scope

Build an English-language, 3D arcade game in which the player controls a small flock of magpies. Players steer and switch between birds, then score points by hitting or frightening away cyclists and runners. Playable magpies have distinct plumage variations: more white, mottled, and mostly black.

The game is offline for this version. Do not add sign-in, multiplayer, a shared leaderboard, or other online features. Keep the managed server and database disabled.

## Gameplay systems

- **3D flight and swooping:** Provide responsive magpie movement and a distinct swoop/dive action suitable for steering toward a target.
- **Target characters:** Populate the play area with cyclists and runners that can react to a magpie's approach.
- **Scoring:** Award points when a person is hit or successfully scared away, and make the result legible during play.
- **Magpie switching and variants:** Allow the player to switch the controlled bird and distinguish birds visually through the requested white-heavy, mottled, and mostly-black plumage variants.

## Audio system

Add an in-game audio system for **simulated magpie calls/song-like vocalizations** and **swooping sound effects**. Use a browser-native, runtime-synthesized approach so the prototype does not depend on unapproved recordings or external audio services:

- Create short, bird-like call phrases that can play during flight and when the player triggers a call.
- Trigger a rushing, airy swoosh in sync with the magpie's dive/swoop, with its intensity following the action where practical.
- Centralize playback and volume/mute handling in an audio manager; initialize audio in response to the player's first interaction to respect browser autoplay restrictions.
- Keep calls and swooping effects as separate controllable sound layers so they can be balanced independently.

## Project approach

Continue the already initialized Three.js game project; do not create a second project. Keep the work in the selected `bshewan32/MagSwoop` repository. Preserve the saved model-production choice and any applicable asset restrictions. The setup model choice was resolved with the recommended option. Models are procedural low-poly meshes built in code.

## Explicitly deferred

Authentication, online leaderboards, multiplayer, and persistent online services are out of scope for now. No server or database is needed for this version.

## Implementation status (first playable)
- [x] 3D flight with flap, boost and auto-targeted homing swoop, plus stamina and perching
- [x] Procedural runners and cyclists on a bike loop and gravel paths. They startle, flee, and walk into the nest ring as intruders
- [x] Scoring for scares and hits, combos, nest-defence bonus, three eggs, a 2:30 season, stars, and local high scores
- [x] Three switchable magpies: Pied (white-backed), Scruffy (mottled juvenile) and Blackback (mostly black), with different handling
- [x] Synthesised magpie carols, alarm calls and chortles, with a separate voice for each bird
- [x] Swoop whoosh, wind, wing flaps, bill clacks, bike bells, yelps and park ambience
- [x] Separate volume buses for Magpie calls, Effects and Ambience, plus Mute. Audio unlocks on the first interaction
- [x] Keyboard/mouse, gamepad and touch controls, with pause, settings and results screens
- [x] Unit tests and a headless smoke playthrough
