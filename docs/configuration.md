# Configuration reference

Everything specific to your home lives in the dashboard's own **`glasshome:`** section. The setup wizard and the
Settings page ([setup-guide.md](setup-guide.md)) write it for you; this page is the reference for editing it by
hand. Where it lives:

- **Dashboard made in the UI:** in the raw configuration editor, as a top-level `glasshome:` key next to `views:`.
- **YAML-file dashboard:** in `/config/glasshome/config.yaml`, included by `glasshome: !include config.yaml`
  in `/config/glasshome/dashboard.yaml`.

Start from [config/glasshome-config.example.yaml](../config/glasshome-config.example.yaml), which lists every
option with fictional values, or [examples/glasshome-config.minimal.yaml](../examples/glasshome-config.minimal.yaml).
Any section can be left out. `demo: true` shows a complete fictional home instead and sends nothing to your
devices; your own sections, if present, override the demo ones.

Demo mode runs in the browser, so two things still show your real Home Assistant: text that Home Assistant
builds from templates (for example the "0 of 4 on" count on the Lights page) and the standard more-info
dialog, which reports that a demo entity does not exist. Cards that would list every camera, battery, update or
automation in your house are hidden in demo mode.

The cards read these settings with Home Assistant's `lovelace/config` call over your signed-in connection, so
they are only visible to people who can log in. **Never** copy them to `/config/www`, which is served to anyone
without signing in.

After every change, reload the dashboard. The **Setup** page (`/glass-home/setup`) shows what is complete,
what is missing and which entity ids could not be found.

## How the dashboard uses it

The dashboard's cards contain tokens that are filled in from these settings when the page loads:

| Token | Meaning |
| --- | --- |
| `[[weather.entity]]` | Replaced by the value. If it is missing, the card becomes a **Set up** box naming the setting. |
| `[[?rooms.0.icon]]` | Optional. If it is missing, the setting is left out and the card still shows. |
| `[[lighting.all\|json]]` | Inserted as JSON, for lists used inside Jinja templates. |

Cards can also carry `feature: energy`, which hides them when that feature is off, `optional: true`, which hides
them instead of showing a Set up box, `unless: rooms`, which shows them only until `rooms` is configured, and `demo: false`, which hides them in demo
mode (used for the cards that list every camera, battery, update or automation in the house).

## setup

```yaml
setup: { complete: true, version: 1, completed: "2026-01-01T10:00:00.000Z" }
```

Written by the setup wizard. `complete: false` opens the welcome screen and the wizard. Settings without a `setup`
section (written by hand) never open the wizard by themselves. `hidden_rooms` keeps rooms you hid in the wizard so
Settings can bring them back; the dashboard ignores it.

## household

```yaml
household: { greeting: Sam, name: The Smiths, timezone: Europe/London, locale: en-GB, clock: 24, temperature_unit: "°C", distance_unit: km }
```

- `greeting`: the name in the greeting, "Good evening, Sam".
- `name`: the home's name, shown in Settings and the Setup title. Without `greeting`, the greeting uses it
  ("Evening, The Smiths"). Use `""` for both for a plain "Good evening".
- `show_greeting: false` hides the greeting.
- `timezone`: IANA zone for the clock, dates and bin days. The default is the device's zone.
- `locale`: date and time format. The default is the browser language.
- `clock`: `24` (default) or `12`.
- `temperature_unit` (`"°C"` or `"°F"`) and `distance_unit` (`km` or `mi`): units for the built-in weather.
- `currency`: a three-letter code such as `GBP`, `EUR` or `USD` for energy costs (default `GBP`). Settings offers
  Home Assistant's own currency until you choose one. Unit rates show in pence or cents for GBP, EUR and USD.

## features

| Switch | Default | Turns on |
| --- | --- | --- |
| `weather` | on | Weather in the welcome panel |
| `lighting` | on | Lights page, favourites and scenes |
| `climate` | on | Climate page and heating pill |
| `news` | on | News pill and reader (needs the Glass Home News integration) |
| `presence` | off | "Home / Away" pill for one person |
| `heating_hive` | off | Hive heating control centre instead of the standard thermostat |
| `energy` | off | Energy page and cards (Octopus Energy) |
| `media` | off | Media page (TV) |
| `spotify` | off | Spotify card on the Media page |
| `music` | off | Music card on the Media page (Apple Music, Music Assistant or another player: `media.music`) |
| `tv_power` | off | TV power button (needs `packages/glasshome_tv_power.yaml`) |
| `cctv` | off | Cameras pill and Security page |
| `laundry` | off | Laundry page (SmartThings washer + package) |
| `bins` | off | Bin collection banner and card |
| `floorplan` | off | Floor plan ("Home Plan") page |

A feature that is off disappears completely: its cards, its navigation button and its pill.

## weather

Either a weather entity from Home Assistant:

```yaml
weather: { entity: weather.forecast_home }
```

Any weather entity with a daily forecast works. Met.no is set up by default in new Home Assistant installs.

Or Glass Home's built-in weather from [Open-Meteo](https://open-meteo.com/), with no account or key:

```yaml
weather:
  provider: open_meteo
  entity: weather.glasshome_forecast
  place: { name: Testville, label: "Testville, Example County", latitude: 12.35, longitude: -45.68 }  # glasshome-validate: allow
```

The browser fetches the forecast for `place` (rounded to two decimals, about 1 km) every 15 minutes and shows it
as the entity `weather.glasshome_forecast`, which exists only inside the dashboard. Pick the place in the setup
wizard or Settings rather than typing coordinates.

## lighting, rooms and scenes

```yaml
lighting:
  all: [light.living_room, light.hallway]           # what "All on / All off" switches
  lights: [light.living_room, switch.tv_led_strip]  # up to 4 favourites (Home and Lights pages)
  power: [null, sensor.tv_led_strip_power]          # optional power sensors, same order as lights
  status_only: []                                   # shown, but never switched by the dashboard
rooms:
  - name: Living Room
    icon: mdi:sofa-outline
    lights: [light.living_room]
    entities: [light.living_room, media_player.tv]
scenes: { bright: scene.bright, relax: scene.relax, evening: scene.evening, night: scene.night, film: scene.film, all_off: scene.all_off }
```

The Rooms page shows every room's `entities`. The first three rooms also get a room switch on the Lights page.
Scene buttons you leave out are hidden. An entry in `entities` can also be `{ entity: light.x, name: Lamp, icon: "mdi:lamp" }`.

```yaml
favourites: [light.living_room, switch.tv_led_strip]
devices:
  light.living_room: { name: Big light, icon: "mdi:ceiling-light" }
  sensor.garden_temperature: { hidden: true }
```

`favourites` lists the devices you starred in the wizard. `devices` renames a device or changes its icon on the
dashboard only (Home Assistant keeps its own name), and `hidden: true` keeps it off the dashboard.

## climate and heating

```yaml
climate: { thermostat: climate.living_room, temperature: sensor.hallway_temperature }
```

`climate.heater` (optional) adds a plug-in heater: `{ switch, power, today, month }`.

With `features.heating_hive`, the `heating` block maps the Hive entities and the helpers created by
`packages/glasshome_heating.yaml`. See the comments in the example file. That package controls real heating:
read [Heating package safety](install.md#heating-package-safety) before installing it.

## presence

`presence: { person: person.alex }` shows a pill with that person's state and how long ago it changed.

## news

```yaml
news:
  todo: todo.glasshome_news
  categories: [top, uk, world, business, technology, sport, science, entertainment]
  custom:
    - { id: local, name: Local, icon: "mdi:map-marker", feeds: ["https://example.com/news/rss"] }
```

`categories` picks and orders the built-in tabs. `custom` adds your own tabs. Feeds are fetched by Home
Assistant through the Glass Home News integration (`glasshome_news.fetch`). It only fetches public `https`
addresses and refuses local and private network addresses (see [SECURITY.md](../SECURITY.md)).

## media

`tv`, `tv_cast`, `tv_remote`, `tv_power_script`, `spotify`, `spotify_device`, `spotify_device_label` and
`spotify_device_note`. See the example file for what each one is.

`spotify` is the `media_player` entity of Home Assistant's Spotify integration, and `spotify_device` is the
Spotify Connect speaker or TV that music plays on, written exactly as Spotify names it (it is one of the
account's `source_list`). **Settings → Media and Spotify** sets both. The Spotify card needs both, and `tv` is
optional for it.

`music` is for any other music service, played through a Home Assistant media player:

```yaml
media:
  music: { service: apple_music, player: media_player.kitchen_speaker }   # apple_music | music_assistant | other
```

With `features.music: true` the Media page shows what's playing with your playlists underneath (whatever the
player's integration lets Home Assistant browse), and the page takes the service's name in the bottom bar.
Home Assistant has no Apple Music integration of its own: Apple Music works through Music Assistant, or the
Apple TV integration for what an Apple TV or HomePod plays (no playlists that way). **Settings → Media and
music** sets this up, with step-by-step guides. `service: spotify` only records that Spotify is the choice;
Spotify uses the settings above.

## cctv

`cctv: { cameras: [{ entity: camera.front_door, name: Front door }] }`. Up to two cameras are shown on the
Security page. The camera pill counts how many are online.

## energy

```yaml
energy:
  supplier: british_gas          # only used to suggest a way to connect
  method: glow                   # octopus | glow | ha_energy | other (or keep, for settings written by hand)
  electricity:
    demand: sensor.home_power                      # live watts (optional)
    today_kwh: sensor.glasshome_electricity_today  # or your own "used today" sensor
    today_from: sensor.home_energy                 # a meter that only counts up: today is worked out from it
    today_cost: sensor.electricity_cost_today      # optional
    rate: sensor.electricity_unit_rate             # optional, per kWh
    standing: sensor.electricity_standing_charge   # optional, per day
    stat_kwh: sensor.home_energy                   # history: a statistic id (usually the meter)
    stat_cost: sensor.electricity_cost             # optional
  gas: { ... }                                     # optional, the same keys without demand
  appliances: [...]
```

**Settings → Energy** fills this in: choose your supplier, then how Home Assistant reads your meter. The
[Octopus Energy](https://github.com/BottlecapDave/HomeAssistant-OctopusEnergy) integration is found by itself;
for any other UK supplier, the Hildebrand Glow (DCC) integration reads the smart meter; or use the meters in Home
Assistant's own Energy dashboard, or choose any power and energy sensors yourself.

Only electricity is needed: the Gas tab is hidden when there is no gas. Without a "used today" sensor, set
`today_from` to a meter (`state_class: total_increasing`) and `today_kwh` to
`sensor.glasshome_electricity_today` (or `_gas_today`): Glass Home adds up today's change in that meter's
Home Assistant statistics in the browser, refreshed every 5 minutes. Costs are shown in pounds.

With the Octopus integration the ids contain your meter serial number, one more reason the settings must stay
out of `/config/www` and out of any public repository.

## laundry

Entity ids from a SmartThings washer plus the helpers from `packages/glasshome_laundry.yaml`. The example file
lists them for a washer named "Washing machine".

## bins

```yaml
bins:
  source: file                         # file | dates | calendar | rotation (what Settings shows)
  rotation: { start: "2026-01-06", every_days: 7, pattern: [[grey], [blue, green]], weeks: 104 }
  schedule: { "2026-12-29": [grey] }   # exact dates (win over the rotation)
  file: council-bins.ics               # the name of the file the schedule came from (shown in Settings)
  calendar:                            # a Home Assistant calendar, read live (instead of schedule)
    entity: calendar.bin_collections
    map: { "recycling and garden waste": [blue, brown] }   # entry text (lower case) -> bins
  reminder_hour: 18                    # banner from this hour the evening before
  types:
    purple: { name: Purple bin, short: Purple, waste: Glass, main: "#8b5cf6", dark: "#5b21b6", lid: "#6d28d9", glow: "139,92,246" }
```

**Settings → Bin collections** fills this in from your council's calendar file (`.ics`, or a CSV), dates you paste
or type, a Home Assistant calendar, or a repeating pattern. It guesses the bins from each entry's words ("Refuse",
"Recycling", "Garden waste", "Food") and you can correct them.

Colours with a drawing: `grey`, `blue`, `green`, `brown`, `black`, `purple`, `red`, `yellow`, `orange` (food
caddy) and `white`. `types` renames them ("Black wheelie bin") or adds your own. `pattern` repeats: week 1 grey,
week 2 blue and green, and so on.

With `calendar`, the dashboard reads the next 120 days from that calendar every 6 hours (and when the screen
wakes after an hour), through your signed-in Home Assistant connection. Entries with no bins in `map` are
guessed from their words. Good sources are Home Assistant's
[Remote calendar](https://www.home-assistant.io/integrations/remote_calendar/) integration with your council's
calendar address, and the [Waste Collection Schedule](https://github.com/mampfes/hacs_waste_collection_schedule)
integration (HACS).

## floorplan

`floorplan: { arch, images, fittings, status_only }`. `images` holds an uploaded picture for each floor. See
[floorplan.md](floorplan.md); the building editor (**Settings → Floor plan**) writes both.

## navigation

`navigation: { pages: [{ id: home, title: Home, icon: "mdi:home-outline" }, ...] }` replaces the bottom
navigation bar. `home` sets the page the dashboard opens on (default `home`). The bar ends with a **Settings**
button; `settings: false` hides it (Settings stays at `/glass-home/settings`). Each `id` must be a homepage page: `media`, `security`, `lights`, `home`, `climate`, `devices`
(floor plan) or `energy`. Add `feature: energy` to an item to hide it when that feature is off.

`titles` renames pages in the bottom bar without replacing it, for example
`navigation: { titles: { lights: Lamps, devices: House } }` (up to 16 characters). Without a name of your own,
the Media page is called after the music service ("Spotify", "Apple Music", "Music"), else "Media".
**Settings → Appearance** sets these.

## layout

`layout: { fit: reflow }` is the default. Below 600px wide the homepage keeps cards at full size, puts small
tiles two to a row and scrolls. `fit: scale` shrinks the whole page to fit instead, for a wall tablet that
should never scroll.

## appearance

`appearance: { background: aurora }` is the default glowing background. `plain` uses a calm dark gradient.
