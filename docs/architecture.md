# How Glass Home works

Glass Home is a Home Assistant dashboard. It has no server, database or account of its own.

```
Browser (signed in to Home Assistant)
 └─ Glass Home dashboard (dashboards/glasshome.yaml, with [[tokens]])
     ├─ glasshome-cards.js        all the cards: pager, welcome panel, lights, climate, setup wizard, settings …
     │   ├─ settings              the dashboard's own glasshome: key, read with lovelace/config
     │   ├─ adapter (ghHass)      one hass object for every card: real, demo, or real + built-in extras
     │   └─ providers             built-in weather (Open-Meteo) as a virtual weather entity
     └─ glasshome-news.js         the news reader (optional)
Home Assistant
 ├─ your integrations and devices (Hue, Matter, Zigbee, …)
 └─ glasshome_news               optional integration that fetches public RSS feeds safely
```

## Settings

Everything about your home is one object, the `glasshome:` key of the dashboard configuration
([configuration.md](configuration.md)). The cards read it over the signed-in websocket connection
(`lovelace/config`), so it is never in a public file. The dashboard's `[[tokens]]` are filled in from it when
the page loads, and any card whose settings are missing becomes a **Set up** box.

The setup wizard and the Settings page write the same object back with `lovelace/config/save`, then read it
again to check it was stored. Home Assistant only allows that for administrators and for dashboards made in the
UI. Otherwise the wizard hands over the settings as YAML instead.

While the wizard runs, its unfinished answers (the *draft*) are kept in Home Assistant's per-user frontend
storage (`frontend/set_user_data`), so the setup resumes after a refresh or on another device. The browser's
session storage is the fallback.

`setup.complete: false` (or no settings at all) sends the dashboard to the welcome screen. Settings written by
hand without a `setup:` section are left alone.

## One architecture, three modes

| Mode | Settings | Devices |
| --- | --- | --- |
| **Personal** | Your `glasshome:` settings | Your Home Assistant |
| **Demo** (`demo: true`) | The built-in demo household, overridden by any of your own sections | A fictional home kept in the browser |
| **Explore the demo** (from the welcome screen) | Only the demo household | A fictional home kept in the browser, for this tab only |

All cards get Home Assistant's state through one adapter (`ghHass`). In demo mode the adapter answers with
demo states and keeps any change in the browser, so no command reaches a real device. In personal mode it
passes through to Home Assistant, adds virtual entities (the built-in weather), applies device names and icons
from `devices:`, and turns a failed command into a visible message. Virtual entities can never be sent to
Home Assistant as commands.

## Setup model

The setup's logic is plain functions with no browser dependencies (between `// @@MODEL-START` and
`// @@MODEL-END` in `glasshome-cards.js`):

- `ghsDiscover` lists devices from Home Assistant's entity, device and area registries; `ghsKind` decides what
  each one is and which controls it has.
- `ghsRoomsFromAreas` turns areas into rooms.
- `ghsBuildConfig` turns the wizard's draft into settings, keeping anything the wizard does not manage (for
  example a hand-drawn floor plan). `ghsDraftFromConfig` goes the other way for the Settings page.
- `ghsProblems` lists what still stops a save. `ghsToYaml` writes the YAML export.
- `ghsOpenMeteoUrl` and `ghsOpenMeteoParse` turn Open-Meteo's forecast into a Home Assistant style weather entity.

`tests/js/setup-model.test.mjs` tests these functions against the shipped file (`node tests/run-js-tests.mjs`).

## Built-in weather

With `weather.provider: open_meteo`, the browser asks Open-Meteo for the forecast at the saved place every 15
minutes and publishes it as the virtual entity `weather.glasshome_forecast`, with daily and hourly forecasts
in Home Assistant's format. The welcome panel and the weather pop-up use it like any weather entity. If a
request fails, Glass Home retries with a growing delay and keeps showing the last forecast, marked as out of
date.

## Where things are stored

| What | Where | Who can read it |
| --- | --- | --- |
| Settings | The dashboard configuration (`glasshome:`) | Signed-in users |
| Unfinished setup | Home Assistant frontend storage for your user, or this browser tab | You |
| Floor-plan layout, small display choices | Frontend storage for your user, or this browser | You |
| Demo devices, "Explore the demo" | This browser | You |
| Card code | `/config/www/glasshome/` (public, code only) | Anyone who can reach Home Assistant |
