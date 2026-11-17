# Install

> **Glass Home 2.0 is a public beta.** It has been tested with automated tests and in the bundled browser
> preview, but **not yet on a clean, separate Home Assistant installation**. Make a backup first
> (Settings → System → Backups). Glass Home adds its own files and dashboard and changes nothing else, and
> [Uninstalling](#uninstalling) removes it. If a step here doesn't match what you see, please open an
> **Installation problem** issue.

## Before you start

- **Home Assistant 2024.11 or newer** (Glass Home uses sections views and `grid_options`).
- An **administrator** account (to add resources and the dashboard, and for the wizard to save).
- A way to copy files into `/config`: the **File editor**, **Samba share** or **Studio Code Server** add-on.
- **HACS**, only to install **card-mod** (required) and kiosk-mode (optional). Glass Home itself is **not** a
  HACS repository yet: you copy its files by hand, as below.

These steps take about 15 minutes. You need access to your Home Assistant `/config` folder, for example
through the **File editor** or **Samba share** add-on, or **Studio Code Server**.

Glass Home installs **next to** your existing dashboards. It uses its own file names (`glasshome*`), its own
URL (`/glass-home`) and its own card names (`glasshome-*`), and changes nothing that is already there.

## 1. Install card-mod

HACS → search **card-mod** → Download, then reload the browser. Glass Home's glass styling needs it.

Optional: **kiosk-mode** (HACS) hides the sidebar and header for non-admin users on wall tablets.

## 2. Copy the files

| From this repository | To your Home Assistant | Needed for |
| --- | --- | --- |
| `www/glasshome/` (whole folder, including `fonts/`) | `/config/www/glasshome/` | Always (card code, background and font only, no settings) |
| `themes/glasshome.yaml` | `/config/themes/glasshome.yaml` | Always |
| `custom_components/glasshome_news/` | `/config/custom_components/glasshome_news/` | News |
| `packages/glasshome_*.yaml` (only the ones you use) | `/config/packages/` | Heating, laundry, TV power |

If `/config/www` did not exist before, restart Home Assistant once so it starts serving `/local/`.

## 3. configuration.yaml (themes, and packages if you use any)

If your `configuration.yaml` does not already load themes from `/config/themes`, add the `frontend:` lines from
[config/configuration.example.yaml](../config/configuration.example.yaml). Add the `homeassistant: packages:`
line only if you copied packages. If you already have a `frontend:` or `homeassistant:` section, add the lines
to it rather than creating a second one.

If you use the TV power package, add the two values from
[config/secrets.example.yaml](../config/secrets.example.yaml) to your `/config/secrets.yaml`.

Restart Home Assistant (Developer tools → YAML → **Check configuration**, then **Restart**). The restart is
also what loads the News integration you copied.

## 4. Add the News integration (only with News)

Settings → Devices & services → **Add integration** → **Glass Home News**. It has no options. It adds one
action, `glasshome_news.fetch`, which fetches **public https** feeds for the reader and refuses local network
addresses (see [SECURITY.md](../SECURITY.md)). For saved stories, also add a **Local To-do** list and put its entity id
(for example `todo.glasshome_news`) in `news.todo` in your settings.

## 5. Add the resources

Settings → Dashboards → ⋮ (top right) → **Resources** → Add resource. Choose **JavaScript module** for each one:

```
/local/glasshome/glasshome-cards.js?v=2.0.0
/local/glasshome/glasshome-news.js?v=2.0.0       (only with News)
```

If you cannot see **Resources**, turn on **Advanced mode** in your user profile.

## 6. Create the dashboard

Your settings (entity ids, room names, which features are on) live **inside the dashboard**, under a top-level
`glasshome:` key. The cards read them over your signed-in Home Assistant connection, so they are never in a
public `/local/` file. Pick one of these two ways:

### A. From the UI (no configuration.yaml change)

1. Settings → Dashboards → **Add dashboard** → **New dashboard from scratch**. Title `Glass Home`, URL
   `glass-home` (if that URL is taken, any other URL works).
2. Open it, ⋮ → **Edit dashboard** → ⋮ → **Raw configuration editor**, and replace everything with the
   contents of [dashboards/glasshome.yaml](../dashboards/glasshome.yaml).
3. In what you pasted, **delete** the line `glasshome: !include config.yaml`.
4. **Save**, close the editor and reload the page. The welcome screen opens: **Get started** runs the setup
   wizard, which saves your settings into the dashboard for you ([setup-guide.md](setup-guide.md)), and
   **Explore the demo** shows a fictional home first. You need to be signed in as an administrator to save.

   Prefer to write the settings yourself? Put them under a top-level `glasshome:` key instead, starting from
   [config/glasshome-config.example.yaml](../config/glasshome-config.example.yaml), or use `glasshome: { demo: true }`.

### B. As YAML files

1. Copy [dashboards/glasshome.yaml](../dashboards/glasshome.yaml) to `/config/glasshome/dashboard.yaml`.
2. Copy [examples/glasshome-config.demo.yaml](../examples/glasshome-config.demo.yaml) (demo) or
   [config/glasshome-config.example.yaml](../config/glasshome-config.example.yaml) (your own) to
   `/config/glasshome/config.yaml`. The dashboard includes it with `glasshome: !include config.yaml`.
3. Register the dashboard with the `lovelace:` lines from
   [config/configuration.example.yaml](../config/configuration.example.yaml), then restart.

`/config/glasshome/` is not served to the web. **Never** put the settings in `/config/www`.

Home Assistant does not let the browser change a YAML-file dashboard, so with this way the setup wizard and the
Settings page give you the finished settings as YAML to copy into `config.yaml`, instead of saving them. To use
the wizard, start with a `config.yaml` that contains only `setup: { complete: false }`.

## 7. Check

1. Open `http://<your-home-assistant>:8123/glass-home/setup` for the checklist.
2. Each item you want should show **Complete**. If one does not, it names the missing setting or entity: change
   it in **Settings** (the last button in the bottom bar). Reload the page after changing settings by hand
   (Ctrl+F5 on a computer, or pull to refresh in the companion app).

With `demo: true` the Settings item shows **Check**: the dashboard shows a fictional home and nothing is sent
to your devices. **Demo mode never changes anything in Home Assistant, including saving settings**, so remove
`demo: true` from the dashboard's raw configuration (or `config.yaml`) before running the setup wizard for your
own home. **Explore the demo** on the welcome screen is different: it lasts only for that browser tab, and
**Exit demo** ends it.

If something doesn't work, see [troubleshooting.md](troubleshooting.md).

## Updating

Replace the files in `/config/www/glasshome/` and `/config/custom_components/glasshome_news/`. Replace the
views in your dashboard with the new [dashboards/glasshome.yaml](../dashboards/glasshome.yaml), keeping your
`glasshome:` settings. Then bump the resource URLs so browsers fetch the new code: edit each resource and change
`?v=` at the end, for example `/local/glasshome/glasshome-cards.js?v=2.0.1`. Read
[CHANGELOG.md](../CHANGELOG.md) for any new options.

## Uninstalling

Delete the Glass Home dashboard (or its `lovelace:` lines), the two resources and the Glass Home News
integration, then delete `/config/www/glasshome/`, `/config/glasshome/`, `/config/custom_components/glasshome_news/`,
`/config/themes/glasshome.yaml` and any `glasshome_*.yaml` packages, and restart.

Glass Home also keeps a few small items in Home Assistant's own frontend storage: an unfinished setup, the
homepage layout (`glasshome_homepage`), the floor plan (`glasshome_floorplan`) and the end time of a heating
boost. They are harmless once the cards are gone. Home Assistant has no screen to delete them; a browser's
local storage may also hold copies (`glasshome.*`), which clearing the site data removes.
