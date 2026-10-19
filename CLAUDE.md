# kintorekiroku

## Skills

- `.claude/skills/ui-ux-pro-max/` is vendored from nextlevelbuilder/ui-ux-pro-max-skill @ 56ea9cf (MIT, v2.15.0).
  Its SKILL.md uses `${CLAUDE_PLUGIN_ROOT}/.claude/skills/...`; here run it from the repo root instead:
  `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain <domain>`

## Tests

- Unit (logic.js): `npm test`
- End-to-end (real Chromium, 390×844): `npm install` once, then `npm run e2e`.
  Uses `/opt/pw-browsers/chromium` if present, else set `CHROMIUM_PATH`.
  The principle tests fail if any control sits on the paper (`.see`) instead of the indigo slab (`.press`), a sheet or the settings slab — keep it that way.
- Run both before every deploy to `main` (GitHub Pages serves `main`).
