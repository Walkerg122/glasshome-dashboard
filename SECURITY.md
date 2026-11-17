# Security

## Reporting a problem

Please report security problems privately through GitHub's **Report a vulnerability** button (Security tab),
not in a public issue. Include the file, what an attacker could do, and how to reproduce it. Never include
your own tokens, passwords or addresses in a report.

## What Glass Home does and does not store

- Glass Home is mostly front-end code: JavaScript cards, a dashboard, a theme and optional packages. It has
  no server of its own and sends no analytics. It talks only to your own Home Assistant and, for News, to the
  public feeds you choose, which **Home Assistant** fetches through the Glass Home News integration.
- Your settings (entity ids, room names, feature switches) are stored **in the dashboard configuration**, under
  `glasshome:`. The cards read them with Home Assistant's authenticated `lovelace/config` call, so only people
  who can sign in to your Home Assistant can read them, exactly like the dashboard itself.
- Floor plan layouts, a few display preferences and an unfinished setup are saved in Home Assistant's frontend
  storage for your user, and fall back to the browser's own storage.
- The setup wizard and Settings page use your **signed-in session**. They never ask for or store a token or
  password. Saving the settings uses Home Assistant's own `lovelace/config/save`, which only administrators may
  call, and is checked by reading the settings back. Clearing the settings replaces only the `glasshome:` section, with `setup: { complete: false }`.
- **Built-in weather.** With `weather.provider: open_meteo`, the browser sends the saved place, rounded to two
  decimals (about 1 km), to `api.open-meteo.com`, and the text you type in the place search to
  `geocoding-api.open-meteo.com`. Nothing else is sent: no names, no device data, no key. Use a Home Assistant
  weather integration instead if you prefer no outside requests from the browser.
- **Accounts and keys.** Spotify, energy suppliers, cameras and council calendars are connected in Home
  Assistant's own integration setup. Glass Home never asks for, stores or sends a password, API key or client
  secret, and talks to none of those services itself: it uses the entities Home Assistant provides.
- **Bin calendars.** An uploaded calendar file is read in your browser; only the dates and the words of each
  entry are saved (in the dashboard settings). A Home Assistant calendar is read through your signed-in
  connection to Home Assistant (`/api/calendars`), never directly from the council.
- **Floor plan pictures** are re-encoded in your browser (WebP or JPEG, at most 1800 pixels) before saving, which
  drops file names and photo details such as location. They are stored in the dashboard configuration with the
  rest of the settings, so the same people who can read the dashboard can see them. Only `png`, `jpeg` and
  `webp` data pictures are drawn; SVG and web addresses are ignored.
- **Diagnostics** (Settings → Advanced) contain versions, counts, feature switches and missing entity ids. They
  never contain your location, your names, your rooms or your addresses. Read them before posting anyway.
- **Export** files contain your settings (room names, entity ids, the weather place). Treat them like the
  settings themselves: never put them in `/config/www` or a public repository. Import accepts only JSON files
  made by Export, and shows what it found before anything changes.

## The News fetcher (SSRF protection)

Browsers cannot read most RSS feeds directly, so the reader asks Home Assistant to fetch them with the
`glasshome_news.fetch` action. A server that fetches any URL it is given can be abused to reach your router,
other devices or Home Assistant itself (server-side request forgery). The integration
(`custom_components/glasshome_news/fetcher.py`) therefore:

- accepts only `https` on port 443, with no user name or password in the URL and no IP-address hosts;
- refuses local names (`localhost`, single-label names, `.local`, `.lan`, `.home.arpa`, `.internal`, ...);
- resolves the name itself and refuses it if **any** address is not a public internet address: private,
  loopback, link-local (including `169.254.169.254`), carrier-grade NAT, multicast, reserved, documentation,
  and IPv4-mapped, 6to4 or Teredo forms of those;
- connects only to the addresses it checked (no DNS cache, no connection reuse), so a name cannot be switched
  to a local address between the check and the connection (DNS rebinding);
- follows at most 3 redirects by hand and checks every target the same way, never downgrading to `http`;
- ignores proxy environment variables, stops after 15 seconds or 2 MB, and returns only text or XML.

The action can only be called by signed-in users. `tests/test_news_fetcher.py` covers these rules.

## Keeping your own setup private

1. **`/config/www` is public.** Anything in `/config/www` (served as `/local/...`) can be downloaded by anyone
   who can reach your Home Assistant, **without signing in**. Glass Home only puts card code there. Never
   copy your settings, a backup of them, or any other personal file into `/config/www`.
2. **Settings hold entity ids and display text only.** Never put passwords, long-lived access tokens, API keys,
   IP addresses, MAC addresses or exact home addresses in them. Network details for Wake-on-LAN go in
   `secrets.yaml`: the TV power package reads them with `!secret glasshome_tv_mac` and
   `!secret glasshome_tv_broadcast`.
3. **Do not commit your own files.** `.gitignore` excludes `glasshome/config.yaml`, `glasshome-config.yaml`,
   `secrets.yaml`, `.storage/`, databases, logs, backups and `.env`. If you fork this repository, keep it that way.
4. **Screenshots.** Before posting a screenshot of your dashboard, check it for names, cameras, addresses
   and energy account details. The screenshots in this repository come from the fictional demo in `tools/preview`.
5. **Run the scanner before you publish anything:**

   ```bash
   node tools/validate.mjs
   ```

   It flags IP and MAC addresses, tokens and JWTs, e-mail addresses, UK postcodes, energy meter serials, real
   `person.` entities and similar values. It never changes or deletes files. Add your own names and street
   to a `.glasshome-private-terms.txt` file (one per line, ignored by git) and they will be flagged too.

## If a secret was committed

Deleting a file in a new commit does **not** remove it from history. Anyone who cloned or forked the repository,
and GitHub's caches, may still have it.

1. **Revoke it first.** Create a new Home Assistant long-lived token and delete the old one, change the
   password, or rotate the API key. Treat the old value as public.
2. Rewrite history with [git filter-repo](https://github.com/newren/git-filter-repo), for example
   `git filter-repo --path secrets.yaml --invert-paths`, or `--replace-text` for a value inside a file.
3. Force-push every branch and tag, ask collaborators to re-clone, and, if the repository was public, ask
   GitHub Support to purge cached views.

## Supported versions

Only the latest release receives fixes.
