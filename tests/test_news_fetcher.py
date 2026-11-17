"""Tests for custom_components/glasshome_news/fetcher.py (no Home Assistant needed).

    pip install aiohttp pytest pytest-asyncio
    pytest tests
"""

from __future__ import annotations

import importlib.util
import pathlib
import socket

import pytest

SPEC = importlib.util.spec_from_file_location(
    "fetcher", pathlib.Path(__file__).parents[1] / "custom_components" / "glasshome_news" / "fetcher.py"
)
fetcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fetcher)

UnsafeUrlError = fetcher.UnsafeUrlError


# ------------------------------------------------------------------ URL rules
@pytest.mark.parametrize("url", [
    "https://feeds.bbci.co.uk/news/rss.xml",
    "https://www.theguardian.com/world/rss",
    "https://feeds.example-news.co.uk:443/rss",
])
def test_public_https_urls_pass(url):
    assert fetcher.check_url(url)


@pytest.mark.parametrize("url", [
    "http://feeds.bbci.co.uk/news/rss.xml",          # not https
    "ftp://example.org/feed",
    "file:///etc/passwd",
    "https://localhost/",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://192.168.1.1/admin",  # glasshome-validate: allow
    "https://10.0.0.1/",  # glasshome-validate: allow
    "https://169.254.169.254/latest/meta-data/",     # cloud metadata
    "https://[fe80::1]/",
    "https://homeassistant.local:8123/",
    "https://nas.lan/",
    "https://router.home.arpa/",
    "https://printer.internal/",
    "https://intranet/",                             # single label
    "https://user:pass@feeds.bbci.co.uk/rss.xml",    # credentials  (glasshome-validate: allow)
    "https://feeds.bbci.co.uk:8443/rss.xml",         # other port
    "https://feeds.bbci.co.uk:80/rss.xml",
    "",
    "not a url",
])
def test_unsafe_urls_are_refused(url):
    with pytest.raises(UnsafeUrlError):
        fetcher.check_url(url)


# ------------------------------------------------------------------ address rules
@pytest.mark.parametrize("ip", ["151.101.0.81", "2a04:4e42::81", "8.8.8.8"])  # glasshome-validate: allow
def test_public_addresses_allowed(ip):
    assert fetcher.address_allowed(ip)


@pytest.mark.parametrize("ip", [
    "127.0.0.1", "127.1.2.3", "0.0.0.0", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.20",  # glasshome-validate: allow
    "169.254.169.254", "100.64.0.1", "192.0.2.1", "198.18.0.1", "224.0.0.1", "255.255.255.255", "240.0.0.1",  # glasshome-validate: allow
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "fec0::1",
    "::ffff:127.0.0.1", "::ffff:192.168.0.1",       # IPv4-mapped  (glasshome-validate: allow)
    "2002:c0a8:0001::1",                            # 6to4 wrapping 192.168.0.1  (glasshome-validate: allow)
    "2001:db8::1",                                  # documentation
    "not-an-ip",
])
def test_private_and_special_addresses_refused(ip):
    assert not fetcher.address_allowed(ip)


# ------------------------------------------------------------------ resolver (DNS rebinding)
class FakeResolver:
    def __init__(self, answers):
        self.answers = answers

    async def resolve(self, host, port=0, family=socket.AF_INET):
        return [{"hostname": host, "host": ip, "port": port, "family": family, "proto": 0, "flags": 0} for ip in self.answers.get(host, [])]

    async def close(self):
        pass


@pytest.mark.asyncio
async def test_resolver_allows_public_names():
    r = fetcher.SafeResolver(FakeResolver({"feeds.example.org": ["151.101.0.81"]}))  # glasshome-validate: allow
    assert (await r.resolve("feeds.example.org", 443))[0]["host"] == "151.101.0.81"  # glasshome-validate: allow


@pytest.mark.asyncio
@pytest.mark.parametrize("answers", [
    ["127.0.0.1"],                       # name pointing at loopback (e.g. 127.0.0.1.nip.io)
    ["192.168.1.20"],                    # pointing at the Home Assistant host  (glasshome-validate: allow)
    ["151.101.0.81", "10.0.0.5"],        # mixed answer: one public, one private -> refused  (glasshome-validate: allow)
    ["::ffff:10.0.0.5"],  # glasshome-validate: allow
    [],                                  # does not resolve
])
async def test_resolver_refuses_private_answers(answers):
    r = fetcher.SafeResolver(FakeResolver({"evil.example.org": answers}))
    with pytest.raises(UnsafeUrlError):
        await r.resolve("evil.example.org", 443)


# ------------------------------------------------------------------ fetch: redirects, size, type
class FakeContent:
    def __init__(self, body):
        self.body = body

    async def iter_chunked(self, n):
        for i in range(0, len(self.body), n):
            yield self.body[i:i + n]


class FakeResponse:
    def __init__(self, status=200, headers=None, body=b"<rss/>"):
        self.status, self.headers, self.content = status, headers or {"Content-Type": "application/rss+xml"}, FakeContent(body)
        self.content_length = None
        self.charset = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def get_encoding(self):
        return "utf-8"


class FakeSession:
    def __init__(self, routes):
        self.routes, self.seen = routes, []

    def get(self, url, **kw):
        assert kw.get("allow_redirects") is False
        self.seen.append(str(url))
        return self.routes[str(url)]


@pytest.mark.asyncio
async def test_fetch_returns_feed():
    s = FakeSession({"https://feeds.example.org/rss": FakeResponse(body=b"<rss>ok</rss>")})
    out = await fetcher.fetch(s, "https://feeds.example.org/rss")
    assert out == {"status": 200, "content": "<rss>ok</rss>", "url": "https://feeds.example.org/rss"}


@pytest.mark.asyncio
async def test_redirect_to_public_https_is_followed():
    s = FakeSession({
        "https://feeds.example.org/rss": FakeResponse(302, {"Location": "https://cdn.example.net/rss.xml"}),
        "https://cdn.example.net/rss.xml": FakeResponse(body=b"<rss/>"),
    })
    out = await fetcher.fetch(s, "https://feeds.example.org/rss")
    assert out["url"] == "https://cdn.example.net/rss.xml"


@pytest.mark.asyncio
@pytest.mark.parametrize("target", [
    "http://feeds.example.org/rss",            # downgrade to http
    "https://192.168.1.20/api/",               # private IP  (glasshome-validate: allow)
    "https://localhost/",
    "https://router.lan/",
    "https://169.254.169.254/",
    "https://feeds.example.org:8123/",
])
async def test_unsafe_redirect_targets_are_refused(target):
    s = FakeSession({"https://feeds.example.org/rss": FakeResponse(301, {"Location": target})})
    with pytest.raises(UnsafeUrlError):
        await fetcher.fetch(s, "https://feeds.example.org/rss")
    assert s.seen == ["https://feeds.example.org/rss"]   # the unsafe target was never requested


@pytest.mark.asyncio
async def test_redirect_loop_is_limited():
    s = FakeSession({"https://a.example.org/": FakeResponse(302, {"Location": "https://a.example.org/"})})
    with pytest.raises(UnsafeUrlError):
        await fetcher.fetch(s, "https://a.example.org/")
    assert len(s.seen) == fetcher.MAX_REDIRECTS + 1


@pytest.mark.asyncio
async def test_large_responses_are_refused():
    s = FakeSession({"https://a.example.org/": FakeResponse(body=b"x" * (fetcher.MAX_BYTES + 1))})
    with pytest.raises(UnsafeUrlError):
        await fetcher.fetch(s, "https://a.example.org/")


@pytest.mark.asyncio
async def test_non_feed_content_is_refused():
    s = FakeSession({"https://a.example.org/": FakeResponse(headers={"Content-Type": "image/png"})})
    with pytest.raises(UnsafeUrlError):
        await fetcher.fetch(s, "https://a.example.org/")


# ------------------------------------------------------------------ the real connector uses the safe resolver
@pytest.mark.asyncio
async def test_session_refuses_loopback_name_end_to_end():
    session = fetcher.create_session(resolver=FakeResolver({"looks-public.example.org": ["127.0.0.1"]}))
    try:
        with pytest.raises(UnsafeUrlError, match="private or local"):
            await fetcher.fetch(session, "https://looks-public.example.org/rss")
    finally:
        await session.close()
