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

Run them at each screen size: 360×800, 390×844, 412×915, 600×960, 768×1024, 1024×768, 1280×800, 1440×900 and
1920×1080, in portrait and landscape.

## Tests for the setup model

```bash
node --test tests/js
```

They load the plain-function part of `www/glasshome/glasshome-cards.js` (between `// @@MODEL-START` and
`// @@MODEL-END`) and test device discovery, rooms from areas, building and reading back settings, the checks
before saving, the YAML export and the Open-Meteo parser. No dependencies.

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
```

It must report no findings. See [SECURITY.md](../SECURITY.md).
