# Features and what they need

Each feature falls into one of four groups:

- **Ready after config**: works with any Home Assistant once you add entity ids.
- **Optional integration**: needs a specific integration (and sometimes a package from `packages/`).
- **Your entities**: built from whatever lights, rooms and cameras you list.
- **Off by default**: switch it on in `features` when you want it.

| Feature | Group | Needs | Default |
| --- | --- | --- | --- |
| Setup wizard and Settings page | Ready after config | An administrator to save (else a YAML copy) | always |
| Explore the demo | Ready after config | Nothing | always |
| Welcome panel (greeting, clock, sky, forecast) | Ready after config | Built-in Open-Meteo weather (no key) or any `weather.*` entity with a daily forecast | on |
| Lighting, favourites, scenes, all on/off | Your entities | Lights or switches; scenes optional | on |
| Light schedules page | Your entities | Lists your automations, with a button to create a new one | on |
| Rooms page | Your entities | `rooms` | on |
| Thermostat (Climate page) | Ready after config | Any `climate.*` entity | on |
| News reader | Optional integration | Glass Home News integration (included), Local To-do integration, `glasshome-news.js` resource | on |
| Setup page | Ready after config | Nothing | always |
| Presence pill | Your entities | A `person.*` entity | off |
| Hive heating control centre | Optional integration | Hive integration, `packages/glasshome_heating.yaml`, a Schedule helper | off |
| Energy page | Optional integration | Any meter in Home Assistant: [Octopus Energy](https://github.com/BottlecapDave/HomeAssistant-OctopusEnergy) (HACS), Hildebrand Glow (any UK smart meter), the Energy dashboard's meters, or your own sensors | off |
| Media page | Your entities | A `media_player.*` TV | off |
| TV power button | Optional integration | Android TV Remote, `packages/glasshome_tv_power.yaml`, MAC address in `secrets.yaml` | off |
| Spotify card | Optional integration | Spotify integration (Spotify Premium) and a chosen speaker | off |
| Music card (Apple Music and others) | Optional integration | Music Assistant (Apple Music, YouTube Music, Tidal, Deezer...), the Apple TV integration, or any `media_player.*` that plays music; playlists need an integration that can browse | off |
| Cameras pill and Security page | Your entities | `camera.*` entities | off |
| Laundry page | Optional integration | SmartThings washer, `packages/glasshome_laundry.yaml` | off |
| Bin collections | Ready after config | Your council's calendar file, a Home Assistant calendar, typed dates or a pattern | off |
| Floor plan | Ready after config | Nothing to start (sample plan). Your own plan from a picture or drawn in the building editor. | off |

## What you see when something is missing

- **Feature off**: nothing. Its cards, navigation button and pill are removed.
- **Feature on, setting missing**: a glass **Set up** box naming the missing setting, with a button to the
  Setup page.
- **Setting present, entity not found**: also a Set up box, naming the entity id that does not exist, which is
  usually a typo or a renamed entity.
- **Optional extras** (a fourth favourite light, a power sensor, a scene button): simply hidden.

## Things that could not be made universal

- **Hive heating centre** relies on Hive's own behaviour: the schedule is applied by keeping the thermostat in
  manual Heat mode. Other thermostats use Home Assistant's standard thermostat card instead.
- **Energy** works with any meter Home Assistant can read. Live cost, unit rates and standing charges need sensors
  that provide them (the Octopus integration does; with other meters they are optional). Costs are shown in pounds.
  Readings that come through the smart meter network (Hildebrand Glow) usually arrive about half an hour late.
- **Laundry** expects the SmartThings washer entities. Other brands would need their own mapping.
- **TV power** is for Android / Google TVs that wake with Wake-on-LAN.
