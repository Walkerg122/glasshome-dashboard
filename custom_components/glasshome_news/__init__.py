"""Glass Home News: fetches public news feeds for the Glass Home dashboard, safely.

Adds one action, glasshome_news.fetch (url -> {status, content, url}), that only reaches public https
addresses. See fetcher.py for the protections. Set up from Settings > Devices & services > Add integration.
"""

from __future__ import annotations

import logging

import aiohttp
import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import HomeAssistantError
import homeassistant.helpers.config_validation as cv

from .const import DOMAIN, SERVICE_FETCH
from .fetcher import UnsafeUrlError, create_session, fetch

_LOGGER = logging.getLogger(__name__)
FETCH_SCHEMA = vol.Schema({vol.Required("url"): vol.All(cv.string, vol.Length(max=2048))})


def _ssl_context():
    try:
        from homeassistant.util.ssl import get_default_context  # noqa: PLC0415

        return get_default_context()
    except ImportError:  # pragma: no cover - older cores
        return None


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Create the safe session and register the fetch action."""
    session = create_session(await hass.async_add_executor_job(_ssl_context))
    hass.data.setdefault(DOMAIN, {})["session"] = session

    async def _close(_event=None) -> None:
        if not session.closed:
            await session.close()

    entry.async_on_unload(hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, _close))
    entry.async_on_unload(_close)

    async def _fetch(call: ServiceCall) -> ServiceResponse:
        url = call.data["url"]
        try:
            return await fetch(session, url)
        except UnsafeUrlError as err:
            _LOGGER.info("Glass Home News refused %s: %s", url[:200], err)
            raise HomeAssistantError(f"Blocked: {err}") from err
        except (aiohttp.ClientError, TimeoutError) as err:
            raise HomeAssistantError(f"Could not fetch the feed: {type(err).__name__}") from err

    hass.services.async_register(DOMAIN, SERVICE_FETCH, _fetch, schema=FETCH_SCHEMA, supports_response=SupportsResponse.ONLY)
    entry.async_on_unload(lambda: hass.services.async_remove(DOMAIN, SERVICE_FETCH))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Nothing else to unload: the session and action are removed by async_on_unload."""
    hass.data.pop(DOMAIN, None)
    return True
