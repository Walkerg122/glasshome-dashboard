# Devices and integrations

Glass Home does not talk to devices itself. **Home Assistant** connects to your devices, and Glass Home shows and
controls what Home Assistant has, over your signed-in connection. So the question "does Glass Home support my
device?" is really "does Home Assistant support it?". Home Assistant supports thousands of devices, but
not every device ever made.

The setup's **Connect your devices** step shows what your Home Assistant already has, and its **Add** buttons
open Home Assistant's own setup for each kind of device (Settings → Devices & services → Add integration).

## Ways devices connect

| Connection | How it works in Home Assistant | What you need |
| --- | --- | --- |
| **Already in Home Assistant** | Glass Home finds every light, switch, plug, thermostat, sensor, camera, media player, cover, lock and scene automatically, with its area | Nothing |
| **Matter** | The Matter integration. Matter devices pair with a code from the device or its box | A Matter-capable Home Assistant (the Matter server add-on, or a Home Assistant Green / Yellow); Thread devices also need a Thread border router |
| **Wi-Fi devices** | Each brand has its own integration (see below). Home Assistant often discovers them on your network by itself | A supported brand. Some need the maker's app or account first |
| **Zigbee** | ZHA (built in) or Zigbee2MQTT | A Zigbee USB adapter or a hub Home Assistant supports |
| **Z-Wave** | Z-Wave JS | A Z-Wave USB adapter |
| **MQTT** | The MQTT integration and a broker (for example the Mosquitto add-on) | A broker, and devices that publish to it |

### Wi-Fi devices: no universal support

"Wi-Fi" only describes how a device reaches your network. It does not say how to control it: every brand speaks
its own language, and some only through the maker's cloud. Glass Home cannot control a Wi-Fi device that Home
Assistant has no integration for. Brands with good Home Assistant integrations, and listed in the setup, include:

- Philips Hue (through the Hue Bridge), TP-Link Kasa and Tapo, Shelly, ESPHome devices
- Tuya and Smart Life (cloud account), Google Cast, Android TV, Sonos, SmartThings, Hive, Ring
- HomeKit accessories (through HomeKit Device), and cameras with an RTSP stream or still-image address

Anything else: check [the Home Assistant integrations list](https://www.home-assistant.io/integrations/).

## What Glass Home does with each kind of device

| Kind | On the dashboard |
| --- | --- |
| Lights | On / off, plus brightness, colour and warmth when the light supports them. Favourites on the home screen |
| Switches and smart plugs | On / off. A plug can be marked as a light (for lamps and LED strips) |
| Thermostats | Climate page with target temperature and mode |
| Media players and TVs | Media page: play / pause, volume, TV power |
| Cameras | Security page and camera pill |
| Covers and blinds | Open / close and position |
| Locks, alarms, vacuums, fans | Shown in their room |
| Sensors | Temperature, humidity, power, energy, doors, windows, motion, smoke and leaks |
| Scenes | Scene buttons on the Lights page |
| Weather | The welcome panel. Without a weather integration, Glass Home's built-in Open-Meteo weather |

## When a device or integration has a problem

- **Offline devices** are marked in the setup, show Home Assistant's "unavailable" state on the dashboard, and work
  again as soon as Home Assistant sees them.
- **Integrations that need attention** (setup failed, needs signing in again) are listed in the setup with a
  **Retry** button that asks Home Assistant to reload that integration. If that does not fix it, open it in
  Home Assistant to see the reason.
- **A command that fails** (a light that does not answer, for example) shows a short message at the bottom of the
  screen instead of failing silently.
- **Features that need a particular integration** (a meter for the Energy page, Spotify for the Spotify card,
  SmartThings for laundry, Hive for the heating centre, Glass Home News for News) stay switched off, with the
  reason shown in the setup, until that integration is there.

## Connections that need an account or a key

Spotify, Apple Music (through Music Assistant or the Apple TV integration), other music services through
Music Assistant, energy suppliers, cloud cameras and council calendars are connected in **Home Assistant**, and Glass Home
uses what Home Assistant provides. **Settings → Connection guides** has step-by-step instructions for each, with
buttons that open Home Assistant's own setup. Glass Home never asks for, stores or sends a password, API key or
client secret: you type those into Home Assistant's integration setup, and they stay there.

## Demo mode

The demo (Explore the demo, or `demo: true`) uses a fictional home that lives only in your browser. Pressing a
button in the demo changes the demo, never a real device.
