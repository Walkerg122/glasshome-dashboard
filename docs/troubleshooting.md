# Troubleshooting

**Finish (or Save changes) says it could not save**
Saving changes the dashboard, which Home Assistant only allows for administrators and for dashboards made in the
UI. Sign in as an administrator, or copy the YAML the wizard shows into the dashboard's raw configuration editor
(under `glasshome:`) or into `/config/glasshome/config.yaml` for a YAML-file dashboard.

**The welcome screen keeps coming back**
The settings say `setup: { complete: false }`, or the dashboard has no `glasshome:` settings. Finish the wizard,
or add your settings by hand. **Exit demo** also returns to the welcome screen until the setup is finished.

**The weather says "out of date" or shows nothing**
The built-in weather needs the browser to reach `api.open-meteo.com`. Check the network or an ad blocker, then
reload. It keeps showing the last forecast while it retries. You can switch to a Home Assistant weather
integration in Settings → Location and weather.

**"Use my location" is missing or does nothing**
Browsers only share the location on `https` pages (or `localhost`) and after you allow it. Search for your town
instead.

**A device is missing from the setup**
Glass Home lists what Home Assistant has. Check Settings → Devices & services in Home Assistant, and that the
entity is not hidden or marked as a diagnostic entity there. See [integrations.md](integrations.md).

**Every card says "Custom element doesn't exist: glasshome-…"**
The resource is missing or failed to load. Check Settings → Dashboards → Resources for
`/local/glasshome/glasshome-cards.js` (JavaScript module), and open that URL in the browser: it should show
code, not "404". If `/config/www` was created after Home Assistant started, restart once.

**The Setup page says "Settings: To do" although I added them**
The settings must be a top-level `glasshome:` key in **this** dashboard's configuration (next to `views:`, not
inside a view or card). In a YAML-file dashboard, check the `glasshome: !include config.yaml` line and that
`config.yaml` sits next to `dashboard.yaml`; Developer tools → YAML → Check configuration shows YAML errors.

**I changed the settings but nothing changed**
**Save changes** in Settings reloads the dashboard by itself. After editing by hand, reload the page (Ctrl+F5 on a computer, pull to refresh in the app). The companion app sometimes caches harder:
Settings → Companion app → Debugging → Reset frontend cache. If you opened Glass Home from another dashboard
without a reload, it reloads itself once to pick up its own settings.

**A card shows "Set up …" but the entity exists**
The Set up box names the entity id it could not find. Compare it with Settings → Entities. Entity ids are case
sensitive and change when a device is renamed.

**Cards look plain, not glass**
card-mod is not installed or not loaded. Install it from HACS and reload.

**News shows no headlines**
Check that the **Glass Home News** integration is added (Settings → Devices & services) and that Developer tools
→ Actions lists `glasshome_news.fetch`. Custom feeds must be public `https` addresses on the standard port; local
names, IP addresses and feeds that resolve to private addresses are refused by design. Saved stories need the
Local To-do list named in `news.todo`.

**TV power does nothing when the TV is off**
Enable Wake-on-LAN / network standby in the TV's settings, and check `glasshome_tv_mac` and
`glasshome_tv_broadcast` in `secrets.yaml`. Many TVs only wake over a wired connection.

**The homepage scrolls on my wall tablet**
Set `layout: { fit: scale }` in the settings to shrink the page to fit instead.

**The bin banner shows the wrong day**
Check `household.timezone` and the `bins.rotation.start` date. It must be a real collection day.
