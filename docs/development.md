# Development and preview

## Local preview

```bash
node tools/preview/serve.mjs          # optional port: node tools/preview/serve.mjs 8124
```

Open <http://localhost:8123/glass-home/home>. The preview serves the real `www/glasshome/` cards and
`dashboards/glasshome.yaml` against a mock Home Assistant (`tools/preview/preview.js`), using the cards' built-in demo mode
(`glasshome: { demo: true }`), the same fictional household Home Assistant users see in demo mode. It listens on localhost only and needs no dependencies.

- `?shot` hides the "demo" badge, for screenshots. `?page=lights` opens a homepage page.
- Run `document.cookie = "ghcfg=none"` in the console and reload to see a fresh install with no `glasshome:`
  settings. The welcome screen and setup wizard open, with a small fictional "real" home (rooms, about 20
  devices, a failing integration and a discovered device) for them to find. Saving in the wizard or Settings
  keeps the settings in this browser's local storage. Open `/glass-home/home?reset` to start again.
- Use `"ghcfg=example"` for `config/glasshome-config.example.yaml`, and `"ghcfg="` to go back to the demo.
- The built-in weather calls the real Open-Meteo service from the browser; everything else stays local.
- Standard Home Assistant cards (tile, button, markdown) are simple look-alikes, and Jinja templates are not
  evaluated (they show "…"). Check those in a real Home Assistant.

## Layout checks

`tools/preview/layout-check.js` is loaded by the preview. In the browser console:

```js
await ghLayoutCheck()   // every homepage page: cards off screen, scale, scrolling, overflow, script errors
await ghSpillCheck()    // the current sections view: cards wider than the screen, content outside its card
```

`tools/preview/responsive-check.js` checks everything at once, from what is actually drawn:

```js
await ghAll()           // every view, homepage page and Settings tab: overflow, overlaps, cut-off text, small text
                        // and touch targets, stretched camera pictures, controls stuck under a floating bar
```

Run them at each screen size: 320×568, 375×812, 390×844, 430×932, 600×960, 768×1024, 1024×768, 1280×800,
1366×768, 1920×1080 and 2560×1440, in portrait and landscape. Browser zoom is the same as a smaller window
(1280 px at 150% behaves like 853 px wide).

These checks run in the preview's emulated window. Glass Home 2.0's responsive layout has been tested this way at
all of the sizes above, but not yet on physical phones, tablets or wall displays, or on a separate Home Assistant
installation: real notches and home bars, iOS Safari's address bar, touch, and Home Assistant's own header and
sidebar are not covered. Reports from real devices are welcome.

## JavaScript tests

Needs Node.js 18 or later; nothing to install. From the repository folder, on Windows, macOS or Linux:

```bash
node tests/run-js-tests.mjs
```

`npm test` runs the same thing. The runner finds every `tests/js/*.test.mjs` file itself and hands them to
Node's built-in test runner, so it does not depend on your shell expanding a wildcard (Command Prompt and
PowerShell do not) or on how your Node version reads `node --test <folder>` (newer versions treat the argument
as a glob pattern and can find no tests in a bare folder). Extra arguments go to `node --test`, for example
`node tests/run-js-tests.mjs --test-name-pattern=demo`.

### The setup model

`tests/js/setup-model.test.mjs` and `tests/js/connections.test.mjs` load the plain-function part of `www/glasshome/glasshome-cards.js` (between `// @@MODEL-START` and
`// @@MODEL-END`) and test device discovery, rooms from areas, building and reading back settings, the checks
before saving, the YAML export and the Open-Meteo parser. No dependencies.

`tests/js/demo-isolation.test.mjs` runs the demo guard (between `// @@DEMO-GUARD-START` and
`// @@DEMO-GUARD-END`) against a mocked Home Assistant connection, `hass` object and `fetch`. It sends every kind
of state-changing request (device actions, scripts, automations, notifications, integration reloads, registry,
dashboard and storage writes, REST calls) by every route and checks that none reaches the mock, that reads still
work, and that nothing is blocked outside demo mode. The preview also logs every request its stand-in server
receives in `window.GlassHomePreviewServer`, so the same can be checked by hand in the browser.

`tests/js/validate.test.mjs` runs the privacy scanner (`tools/validate.mjs`) on throw-away folders: it must
ignore test caches, still report a sensitive value in a release file, in a git-tracked file inside a cache or
`node_modules` folder, and in git history.

## Tests for the News integration

```bash
pip install aiohttp pytest pytest-asyncio
pytest tests
```

They cover the URL rules, private and special addresses, DNS answers that point at local addresses, unsafe
redirects, size and content-type limits, without Home Assistant or network access.

## Before publishing

```bash
node tools/validate.mjs
node tools/validate.mjs --history
```

Both must report no findings. See [SECURITY.md](../SECURITY.md). Test and tool caches (`.pytest_cache`,
`__pycache__`, `.mypy_cache`, `.ruff_cache`, `.tox`, `.nox`, virtual environments, `node_modules`, `dist`) are
generated, never published and not scanned, so running the tests first does not cause findings. Any file that
git tracks is always scanned, even inside one of those folders.
