# Setting up Glass Home

Glass Home sets itself up from inside the dashboard. You do not need to write any YAML.

## Before you start

- Glass Home is a dashboard for **Home Assistant**. Your devices are connected to Home Assistant first, and Glass
  Home shows them. If Home Assistant can see a device, Glass Home can use it.
- Sign in to Home Assistant as an **administrator** for the setup. Saving the setup changes the dashboard, and
  only administrators can do that. Everyone in the house can use the dashboard afterwards.
- Install the files and add the dashboard first ([install.md](install.md), steps 1 to 6).

## The first visit

Open the dashboard. If it has no settings yet, the welcome screen opens:

- **Get started** walks you through the setup. It takes about five minutes.
- **Explore the demo** shows a complete fictional home. Nothing in the demo talks to your real devices. A small
  bar at the top lets you **Set up my home** or **Exit demo** at any time.

## The steps

Every step saves as you go. You can close the page, refresh or come back on another device signed in as the same
user, and the setup carries on where you left it. **Back** and the step list at the top let you go back and
change anything. Nothing changes on your dashboard until you press **Finish** at the end.

1. **About you and your home.** The name for the greeting ("Good evening, James"), the home's name, 12 or 24-hour
   clock, °C or °F, kilometres or miles, and your time zone. The preview shows the greeting as it will look.
2. **Location and weather.** Search for your town or postcode area and pick it from the list, or use **Use my
   location** in the browser. Glass Home then gets the weather from [Open-Meteo](https://open-meteo.com/), with no
   account or key. If you already have a weather integration in Home Assistant (for example Met.no), you can pick
   it instead. You can skip this step.
3. **Connect your devices.** This shows what Home Assistant already knows: the devices it found, the integrations
   you have, anything that needs attention (with a **Retry** button), and devices Home Assistant has discovered on
   your network but not added yet. **Add** opens Home Assistant's own setup for that kind of device. See
   [integrations.md](integrations.md) for what works and how.
4. **Rooms.** If your devices already have areas in Home Assistant, **Use my Home Assistant areas** makes a room for
   each one with its devices in it. You can also pick suggested rooms or type your own, rename, reorder, give
   each room an icon and hide rooms you do not want on the dashboard.
5. **Devices.** Every device, with search and filters. For each one you can rename it (on the dashboard only), pick
   an icon, move it to a room, mark it as a favourite (favourites appear on the home screen), mark a smart plug as
   a light, or hide it. Devices that are offline are marked, and stay usable once they come back.
6. **Make it yours.** Choose the background, the start screen, which pages appear in the bottom bar, how the
   page behaves on narrow screens, and whether to show the greeting.
7. **Extras.** Turn optional parts on or off: lights and scenes, climate, presence, media, Spotify, cameras,
   energy, laundry, bin day, floor plan and news, and pick the thermostat, TV, cameras and scene buttons each one
   uses. Bin day, energy and Spotify have their full setup right here (see below). Glass Home checks what you have.
   A feature it cannot support yet says why (for example "needs the Glass Home News integration") instead of
   showing a broken card. **How to set this up** opens step-by-step help in place.
8. **Finish.** A summary of what will be saved. **Finish** saves the settings into the dashboard, reads them back to
   check they were stored, and shows **Your Glass Home is Ready**. **Open my dashboard** takes you to it.

If something stops the setup being saved (for example a weather choice without a place, or two rooms with the
same name), the Finish step lists it with a link to the step that needs fixing.

## Changing things later

The **Settings** button at the end of the bottom bar opens the Settings page. It has the same choices as the
setup, in tabs, and these:

- **Bin collections.** Where your collection dates come from:
  - **Council calendar file**: on your council's bin day page, enter your postcode and download the calendar
    (**Add to calendar**, **iCal** or **.ics**), then upload it. A spreadsheet saved as CSV works too. Only a PDF?
    Paste the dates instead, one collection per line.
  - **Home Assistant calendar**: a calendar kept up to date for you, such as the Remote calendar integration with
    the council's calendar address, or Waste Collection Schedule (HACS). It is read again every few hours.
  - **Type the dates**, or a **Repeating pattern** (every week or fortnight).

  Glass Home guesses which bins each entry means and shows the next collections. Tap the colours to correct it,
  and rename your bins ("Black wheelie bin"). After saving, the home screen's bin tile and the reminder banner the
  evening before use these dates.
- **Energy.** Choose your supplier, then how Home Assistant reads your meter: the Octopus Energy integration, any
  UK smart meter through Hildebrand Glow, the meters in Home Assistant's own Energy dashboard, or sensors you
  choose (a clamp meter or smart plugs). **Suggest meters** fills in what it can find. Today's use is worked out
  from a meter if you have no "today" sensor.
- **Media and music.** Your TV, and your music service: Spotify, Apple Music, Music Assistant (YouTube Music,
  Tidal, Deezer and more) or any other music player in Home Assistant. Spotify takes three steps: connect it to
  Home Assistant (Spotify Premium and a free Spotify developer app; the guide shows how), choose the account, and
  choose the speaker or TV music plays on. The others: follow the guide to add Music Assistant or the player's
  integration, then choose the player. Home Assistant has no Apple Music integration of its own, so Apple Music
  goes through Music Assistant (your playlists) or the Apple TV integration (what an Apple TV or HomePod plays).
  The Media page shows what's playing with your playlists underneath, and takes the service's name.
- **Appearance** also renames the pages in the bottom bar, and **Profile** sets the currency for energy costs.
  In **Extras**, **Match by name** fills the scene buttons with scenes whose names fit.
- **Floor plan.** Upload a picture of your floor plan or draw it in the building editor (see
  [floorplan.md](floorplan.md)), then place your devices on the Plan page.
- **Connection guides.** Step-by-step help for everything that needs an account, a key or an app: Spotify, Apple Music, Music Assistant, other music players, Octopus
  Energy, any UK smart meter, clamp meters, the Energy dashboard, cameras, bin calendars, weather, news and the TV
  power button, with buttons that open Home Assistant's own setup. Keys and passwords always go into Home
  Assistant, never into Glass Home.

and **Advanced**:

- **Export** the settings as a JSON file (to import later) or as YAML (for a YAML-file dashboard).
- **Import** a JSON file made by Export. You see what it contains before anything changes.
- **Open the wizard** to walk through the setup again with your current settings filled in.
- **Reset the demo** ends an "Explore the demo" session in this browser.
- **Clear settings** removes Glass Home's settings from this dashboard and opens the welcome screen again. Your
  devices, Home Assistant and other dashboards are not touched. Export first if you might want them back.
- **Copy diagnostics** copies a short report for a bug report. It contains versions, counts and the names of
  missing entities, never your location, your names or your rooms.

**Save changes** saves, then reloads the dashboard so every card picks up the change.

## If you are not an administrator, or the dashboard is a YAML file

The setup still runs and shows you the result, but cannot save it into the dashboard. The Finish step (and Save
in Settings) then gives you the settings as YAML to copy or download. An administrator pastes them under
`glasshome:` in the dashboard's raw configuration editor, or into `/config/glasshome/config.yaml` for a YAML-file
dashboard.
