
import json
import re
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

ALLOWED_SCHEMES = {"http", "https"}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-IN,en;q=0.9",
}

GENERIC_TITLES = {
    "amazon",
    "amazon.in",
    "flipkart",
    "flipkart.com",
    "online shopping",
    "just a moment...",
}


def _clean_text(value):
    if isinstance(value, str):
        value = re.sub(r"\s+", " ", value).strip()
        return value or None
    return None


def _valid_product_title(value, hostname):
    title = _clean_text(value)
    if not title:
        return None

    normalized = title.lower()
    host = (hostname or "").lower().removeprefix("www.")

    if normalized in GENERIC_TITLES:
        return None

    if normalized == host or normalized == host.split(".")[0]:
        return None

    return title


def _extract_price(value):
    if value is None:
        return None

    try:
        price = float(str(value).replace(",", "").strip())
        if price > 0:
            return price
    except (ValueError, TypeError):
        pass

    return None


def scrape_product_page(url: str):
    parsed = urlparse(url)

    if parsed.scheme not in ALLOWED_SCHEMES or not parsed.hostname:
        return {
            "status": "error",
            "message": "Enter a valid http(s) product URL",
        }

    try:
        response = requests.get(
            url,
            headers=HEADERS,
            timeout=15,
            allow_redirects=True,
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        return {
            "status": "error",
            "message": (
                "Could not retrieve product page: "
                f"{exc.__class__.__name__}"
            ),
        }

    soup = BeautifulSoup(response.text, "html.parser")
    hostname = urlparse(response.url).hostname

    title = None
    price = None
    image_url = None
    currency = None

    # Try JSON-LD product metadata.
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or script.get_text())
        except (json.JSONDecodeError, TypeError):
            continue

        stack = data if isinstance(data, list) else [data]

        while stack:
            candidate = stack.pop()

            if isinstance(candidate, list):
                stack.extend(candidate)
                continue

            if not isinstance(candidate, dict):
                continue

            graph = candidate.get("@graph")
            if isinstance(graph, list):
                stack.extend(graph)

            types = candidate.get("@type", [])
            if isinstance(types, str):
                types = [types]

            if not any(
                item in {"Product", "ProductGroup"}
                for item in types
            ):
                continue

            title = _valid_product_title(
                candidate.get("name"), hostname
            ) or title

            image = candidate.get("image")
            if isinstance(image, list):
                image = image[0] if image else None
            if isinstance(image, dict):
                image = image.get("url")

            image_url = image_url or _clean_text(image)

            offers = candidate.get("offers", [])
            if isinstance(offers, dict):
                offers = [offers]

            for offer in offers if isinstance(offers, list) else []:
                if not isinstance(offer, dict):
                    continue

                price = price or _extract_price(
                    offer.get("price") or offer.get("lowPrice")
                )
                currency = currency or offer.get("priceCurrency")

    # Fall back to Open Graph and common metadata.
    if not title:
        for key, attr in [
            ("og:title", "property"),
            ("twitter:title", "name"),
        ]:
            node = soup.find("meta", attrs={attr: key})
            if node:
                title = _valid_product_title(
                    node.get("content"), hostname
                )
                if title:
                    break

    if not image_url:
        node = soup.find("meta", property="og:image")
        if node:
            image_url = _clean_text(node.get("content"))

    if price is None:
        for selector in [
            {"property": "product:price:amount"},
            {"itemprop": "price"},
        ]:
            node = soup.find("meta", attrs=selector)
            if node:
                price = _extract_price(
                    node.get("content") or node.get("value")
                )
                if price is not None:
                    break

    if not title:
        return {
            "status": "partial",
            "message": (
                "The page was retrieved, but no reliable product title "
                "was found. The retailer may restrict automated access."
            ),
            "title": None,
            "current_price": None,
            "image_url": None,
            "currency": currency,
            "url": response.url,
            "price_status": "unavailable",
        }

    return {
        "status": "success" if price is not None else "partial",
        "title": title,
        "current_price": price,
        "image_url": image_url,
        "currency": currency,
        "url": response.url,
        "price_status": "observed" if price is not None else "unavailable",
    }
