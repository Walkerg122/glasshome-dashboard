# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/) and
versions follow [Semantic Versioning](https://semver.org/).

## [2.0.0] - unreleased

Brings the demo up to date with the primary dashboard it was built from, and adds a setup wizard so nobody has
to write YAML.

### Added
- **Setup wizard.** A welcome screen (**Get started** or **Explore the demo**) and eight steps: you and your home,
  location and weather, connect your devices, rooms, devices, look, features and finish. It finds devices and
  rooms from Home Assistant's registries, saves its progress per user so it resumes after a refresh, checks
  for problems before saving, and saves the settings into the dashboard, reading them back to confirm.
  Non-administrators and YAML-file dashboards get the settings as YAML instead.
- **Settings page** (`/glass-home/settings`, the last button in the bottom bar): every wizard choice in tabs,
  plus export (JSON or YAML), import, re-run the wizard, reset the demo, clear the settings and copy diagnostics.
- **Connect your devices**: what Home Assistant has, integrations that need attention (with Retry), devices
  discovered on the network, and links into Home Assistant's own setup for Matter, Zigbee, Z-Wave, MQTT and
  common Wi-Fi brands ([docs/integrations.md](docs/integrations.md)).
- **Built-in weather** from Open-Meteo with place search and no key (`weather.provider: open_meteo`).
- **Explore the demo** from the welcome screen, with a bar to set up or leave the demo.
- New settings: `setup`, `household.greeting` / `clock` / `show_greeting` / `temperature_unit` /
  `distance_unit`, `favourites`, `devices` (names, icons, hiding), `navigation.home`, `navigation.settings`,
  `appearance.background`.
- A message at the bottom of the screen when a device command fails.
- Unit tests for the setup model (`node --test tests/js`), and a fictional "real" home in the preview for the
  wizard (`ghcfg=none`).
- The Space Grotesk font is now included (`www/glasshome/fonts/`, SIL Open Font Licence).
- **Bin collections** settings: upload your council's calendar (`.ics` or CSV), paste or type dates, read a Home
  Assistant calendar live, or a repeating pattern. Bins are guessed from each entry and can be corrected and
  renamed; six more bin colours, including a food caddy. The home screen tile and reminder banner use the result.
- **Energy** settings: choose your supplier and how Home Assistant reads the meter (Octopus Energy, any UK smart
  meter through Hildebrand Glow, Home Assistant's Energy dashboard, or your own sensors), with meter suggestions.
  "Used today" can be worked out from a meter's statistics. Gas is optional.
- **Spotify** connector in Settings → Media and Spotify: connect through Home Assistant, choose the account and the
  speaker.
- **Building editor** for the Plan page: upload a picture of your floor plan, draw walls, rooms, doors and
  windows, several floors, undo. Opened from Settings → Floor plan or the Plan page (Edit → Building).
- **Connection guides** tab with step-by-step setup for Spotify, energy, cameras, bin calendars and more.
- Docs: [setup guide](docs/setup-guide.md), [devices and integrations](docs/integrations.md),
  [how it works](docs/architecture.md).

### Changed
- Brought in line with the primary dashboard: the Liquid Glass look, the weather pop-up, the climate page that
  fits a tablet without scrolling, the compact heating cards, the clock and the "Plan" page name.
- The theme is generated from the primary dashboard's theme.
- The clock follows `household.timezone`.
- The Energy page no longer needs Octopus Energy, and its wording only mentions Octopus when that is the meter.

- **Music services on the Media page.** Choose Spotify, Apple Music, Music Assistant (YouTube Music, Tidal,
  Deezer and more) or any other music player in **Settings → Media and music**, with step-by-step guides for
  each. A new music card shows what's playing with your playlists underneath and plays them on the chosen
  player. Apple Music works through Music Assistant or the Apple TV integration, because Home Assistant has no
  Apple Music integration of its own (`media.music`, `features.music`).
- The Media page takes the music service's name ("Spotify", "Apple Music") in the bottom bar.
- **Rename the pages** in the bottom bar (Settings → Appearance, `navigation.titles`).
- **Currency** for energy costs (Settings → Profile, `household.currency`); unit rates in pence or cents.
- **Match by name** fills the scene buttons with scenes whose names fit (for example "Movie night" for film);
  the wizard does this the first time.
- The welcome screen lists the eight setup steps under "Welcome! Follow these steps to set up your new
  dashboard", with what each one covers.
- The wizard chooses for you when Home Assistant has only one choice (thermostat, person, TV, Spotify account,
  bin calendar), brings in Home Assistant's areas the first time you open Rooms, and selects every camera when
  you switch Cameras on. A choice you clear stays cleared.
- The TV list puts real TVs first and leaves out the Spotify account.
- A Home Assistant bin calendar is read as soon as you choose it.
- Settings on phones: a menu to pick the section instead of a sideways row of 13 tabs. Settings stays on the
  same section after you save, and the chosen tab is scrolled into view.

### Fixed
- The font was loaded from a path that did not exist in Glass Home.
- The Finish summary lists features by name ("Cameras", "Floor plan") instead of their settings keys.
- The Energy page's appliance note no longer names one household's plugs.
- All on and All off on the Lights page now switch every light in the settings, not only the first four.
- Times (sunrise, sunset, "since", washer, Spotify) follow the 12-hour clock setting.
- The Energy pill shows today's kWh when there are no cost sensors, instead of dashes.
- Spotify: music on a speaker shows that speaker's volume, not the TV's; an empty library or a failed load no
  longer shows "Loading your library" for ever; the wording names the speaker you chose.
- Settings fit phone screens: four tabs were wider than the screen.
- Rooms with no devices yet are kept in the settings (and listed on the Finish step) instead of disappearing.
- Import refuses files that are not Glass Home settings, and the welcome screen can restore a settings file.
- The setup checklist no longer marks the sample floor plan as done, no longer reports the browser-made
  "used today" sensors as missing, and treats gas as optional.
- News says when the to-do list for saved stories is missing, with a button to add one.
- The Finish summary names integrations ("Android TV Remote") instead of showing their internal ids.
- The homepage works with Weather switched off: the clock, greeting and pills stay, and the weather block is
  left out instead of the whole top card becoming a "Set up Weather" box.
- The homepage leaves out the Indoor, Lights and Cameras pills when those features are switched off or have
  nothing set up, instead of showing "–" or "0/0 online".
- The bin reminder banner fits phones: the text no longer squeezes to one word a line, and the second bin is
  no longer cut off.
- Settings → Bin collections shows the next collection from a Home Assistant calendar instead of "No
  collections yet".
- Energy wording follows the currency ("Costs are shown in EUR (€)"; VAT, GST or tax).
- Home or away switched on without a person, or Cameras without a camera, is pointed out before saving
  instead of being dropped.
- Settings no longer use the wizard's words ("in the next step", "Extras"); the building editor says "in the
  panel".
- Scenes that have never been used no longer show as "Offline".
- The Finish summary leaves failing integrations out of "Connected through".
- The wizard and Settings count the same media players.
- On phones the demo bar sits above the bottom bar instead of over the greeting.
- "Reset the demo" only shows in demo mode.

### Security
- Demo mode now refuses every action that is not on a demo device: on the Glass Home dashboard nothing is
  sent to Home Assistant (a light, lock, script or notification on a real entity is stopped and said on
  screen). Other dashboards are not affected.
- The Home / Away pill (and the person saved for it) only appears with Home or away switched on, so the
  dashboard never shows whether someone is in unless you chose that.
- Example comments in the cards use neutral entity ids.
- `.gitignore` also keeps exported settings files, camera media, browser captures and backups out of git.
- New release checks (`tests/js/privacy.test.mjs`): demo settings use only demo entities, demo mode blocks
  real actions, demo cameras never ask the server for a picture, and installed files carry no private
  addresses, hardware ids, tokens, stream addresses or home coordinates.

## [1.0.0] - unreleased

First public release, built from a private home dashboard that had been in daily use.

### Added
- One settings section (`glasshome:` in the dashboard configuration) for everything household-specific. It
  is read over the signed-in Home Assistant connection, never from a public `/local/` file. The dashboard
  uses `[[tokens]]` filled in from it, so the views never need editing.
- Demo mode (`glasshome: { demo: true }`): a complete fictional home, with nothing sent to real devices.
- Feature switches (`features`). Optional integrations are off by default and disappear completely when off.
- A "Set up" placeholder card instead of broken cards, naming the missing setting or entity.
- Setup page (`/glass-home/setup`) with a progress bar. An item counts as done only when its settings exist and
  every entity it names is found in Home Assistant.
- Rooms from config (`rooms`), with a rooms overview card.
- Bin collections from a rotation and/or exact dates; custom bin colours.
- Floor plan from config (`floorplan.arch`), with a fictional sample plan until you add your own.
- News: categories and custom feeds, fetched by the Glass Home News integration (public https feeds only).
- Reflow layout for phones: below 600px the homepage keeps full size and re-flows instead of shrinking
  (`fit: scale` restores the shrink-to-fit cover layout).
- Glass Home News integration (`custom_components/glasshome_news`): fetches public https feeds and refuses
  local, private and link-local addresses, unsafe redirects and names that resolve to them (SSRF protection).
- Packages for TV power (Wake-on-LAN with `!secret`), Hive heating schedule and laundry tracking.
- Local preview with demo data (`tools/preview`) and a sensitive-value scanner (`tools/validate.mjs`).

### Changed
- Time zone and date format follow `household.timezone` / `household.locale` instead of fixed values.
- Notifications use `notify.notify` by default.

### Removed
- All household-specific names, devices, entities, addresses and account details.
- Features that only made sense for the original household.
- The open `rest_command` news fetcher, replaced by the integration above.
