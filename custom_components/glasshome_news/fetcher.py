"""Safe fetching of public news feeds for Glass Home.

The dashboard asks Home Assistant to fetch RSS feeds because browsers cannot read them directly. Anything
that fetches a URL chosen by a user is a server-side request forgery (SSRF) risk: it could be pointed at
the router, another device on the network, or Home Assistant itself. This module only fetches public
https addresses:

* Only https, only port 443, no user name or password in the URL, no IP-address hosts, no local names
  (.local, .lan, .home.arpa, localhost, single-label names, ...).
* DNS is resolved here. If ANY address the name resolves to is not a public internet address (private,
  loopback, link-local, carrier-grade NAT, multicast, reserved, documentation, IPv4-mapped or 6to4/Teredo
  forms of those, ...) the request is refused.
* The connection is made to exactly the addresses that were checked (the resolver is part of the
  connector and the DNS cache is off), so a name cannot be re-pointed at a local address between the
  check and the connection (DNS rebinding).
* Redirects are followed by hand, at most 3, and every target goes through the same checks.
* Proxies from the environment are ignored, responses are limited to 2 MB and 15 seconds, and only
  text / XML responses are returned.

This file has no Home Assistant imports so it can be tested on its own.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
import ssl
from typing import Any

import aiohttp
from aiohttp.abc import AbstractResolver
from yarl import URL

MAX_BYTES = 2_000_000
MAX_REDIRECTS = 3
TIMEOUT_SECONDS = 15
ALLOWED_PORTS = {443}
REDIRECT_CODES = {301, 302, 303, 307, 308}
BLOCKED_SUFFIXES = (
    ".local", ".lan", ".home", ".internal", ".intranet", ".private", ".corp", ".localdomain", ".localhost",
    ".arpa", ".test", ".invalid", ".example", ".onion", ".home.arpa",
)
BLOCKED_NAMES = {"localhost", "homeassistant", "router", "gateway", "wpad", "metadata", "metadata.google.internal"}
ALLOWED_TYPES = ("xml", "rss", "atom", "text/")
USER_AGENT = "GlassHome-News/1.0 (+Home Assistant)"


class UnsafeUrlError(Exception):
    """The URL or one of the addresses it resolves to is not allowed."""


def address_allowed(value: str) -> bool:
    """True only for globally routable unicast addresses."""
    try:
        ip = ipaddress.ip_address(value.split("%", 1)[0])
    except ValueError:
        return False
    candidates = [ip]
    if ip.version == 6:
        if ip.ipv4_mapped:
            candidates.append(ip.ipv4_mapped)
        if ip.sixtofour:
            candidates.append(ip.sixtofour)
        if ip.teredo:
            candidates.extend(ip.teredo)
    for c in candidates:
        if (
            not c.is_global
            or c.is_private
            or c.is_loopback
            or c.is_link_local
            or c.is_multicast
            or c.is_reserved
            or c.is_unspecified
            or (c.version == 6 and c.is_site_local)
        ):
            return False
    return True


def check_url(raw: str) -> URL:
    """Validate a URL before any network access. Returns the parsed URL or raises UnsafeUrlError."""
    if not isinstance(raw, str) or len(raw) > 2048:
        raise UnsafeUrlError("not a valid address")
    try:
        url = URL(raw.strip())
    except (ValueError, TypeError) as err:
        raise UnsafeUrlError("not a valid address") from err
    if url.scheme != "https":
        raise UnsafeUrlError("only https addresses are allowed")
    if url.user is not None or url.password is not None:
        raise UnsafeUrlError("addresses with a user name or password are not allowed")
    host = (url.raw_host or "").rstrip(".").lower()
    if not host:
        raise UnsafeUrlError("the address has no host name")
    try:
        ipaddress.ip_address(host.strip("[]"))
        raise UnsafeUrlError("IP addresses are not allowed, use a public host name")
    except ValueError:
        pass
    if "." not in host or host in BLOCKED_NAMES or any(host.endswith(s) for s in BLOCKED_SUFFIXES):
        raise UnsafeUrlError("local and internal host names are not allowed")
    if not all(part and len(part) <= 63 for part in host.split(".")):
        raise UnsafeUrlError("not a valid host name")
    if (url.port or 443) not in ALLOWED_PORTS:
        raise UnsafeUrlError("only the standard https port (443) is allowed")
    return url


class SafeResolver(AbstractResolver):
    """Resolves with the system resolver and refuses names that reach a non-public address."""

    def __init__(self, inner: AbstractResolver | None = None) -> None:
        self._inner = inner or aiohttp.ThreadedResolver()

    async def resolve(self, host: str, port: int = 0, family: int = socket.AF_INET) -> list[dict[str, Any]]:
        results = await self._inner.resolve(host, port, family)
        if not results:
            raise UnsafeUrlError("the host name did not resolve")
        bad = [r["host"] for r in results if not address_allowed(r["host"])]
        if bad:
            # Every address must be public: a name that also points at a local address is refused outright
            raise UnsafeUrlError("the host name points to a private or local network address")
        return results

    async def close(self) -> None:
        await self._inner.close()


def create_session(ssl_context: ssl.SSLContext | None = None, resolver: AbstractResolver | None = None) -> aiohttp.ClientSession:
    """A session whose every connection goes through SafeResolver (no DNS cache, no reuse, no proxies)."""
    connector = aiohttp.TCPConnector(
        resolver=SafeResolver(resolver),
        use_dns_cache=False,
        force_close=True,
        ssl=ssl_context if ssl_context is not None else True,
        limit=4,
    )
    return aiohttp.ClientSession(connector=connector, trust_env=False, headers={"User-Agent": USER_AGENT})


async def fetch(session: aiohttp.ClientSession, raw_url: str) -> dict[str, Any]:
    """Fetch a public feed. Returns {status, content, url}; raises UnsafeUrlError or aiohttp errors."""
    url = check_url(raw_url)
    timeout = aiohttp.ClientTimeout(total=TIMEOUT_SECONDS)
    for _ in range(MAX_REDIRECTS + 1):
        async with session.get(url, allow_redirects=False, timeout=timeout,
                               headers={"Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1"}) as resp:
            if resp.status in REDIRECT_CODES:
                location = resp.headers.get("Location")
                if not location:
                    raise UnsafeUrlError("redirect without a target")
                url = check_url(str(url.join(URL(location))))
                continue
            ctype = (resp.headers.get("Content-Type") or "").lower()
            if resp.status < 400 and ctype and not any(t in ctype for t in ALLOWED_TYPES):
                raise UnsafeUrlError("the address did not return a feed")
            declared = resp.content_length
            if declared is not None and declared > MAX_BYTES:
                raise UnsafeUrlError("the response is too large")
            body = bytearray()
            async for chunk in resp.content.iter_chunked(65536):
                body.extend(chunk)
                if len(body) > MAX_BYTES:
                    raise UnsafeUrlError("the response is too large")
            text = bytes(body).decode(resp.get_encoding() if resp.charset else "utf-8", errors="replace")
            return {"status": resp.status, "content": text, "url": str(url)}
    raise UnsafeUrlError("too many redirects")


__all__ = ["UnsafeUrlError", "address_allowed", "check_url", "create_session", "fetch", "SafeResolver", "asyncio"]
