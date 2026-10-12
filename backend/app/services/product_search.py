
import os
import re
from unittest import result
import requests

from urllib.parse import parse_qs, urlparse

SERPAPI_URL = "https://serpapi.com/search.json"
MAX_RESULTS = 20
REQUEST_TIMEOUT = 20

TARGETED_SEARCHES = (
    "Amazon India",
    "Flipkart",
    "Croma",
    "Reliance Digital",
)

INDIAN_RETAILER_ALIASES = (
    "amazon.in",
    "amazon india",
    "flipkart",
    "croma",
    "reliance digital",
    "vijay sales",
    "tata cliq",
    "tatacliq",
    "jiomart",
    "shopsy",
    "poorvika",
    "sangeetha mobiles",
    "samsung india",
    "apple india",
)

STOP_WORDS = {
    "a", "an", "and", "for", "in", "of", "on",
    "the", "with", "new", "online", "official",
}

class ProductSearchError(Exception):
    """Raised when external product search fails."""


def normalize_text(value: str | None) -> str:
    text = (value or "").lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_retailer_name(retailer: str | None) -> str:
    return normalize_text(retailer)



def is_indian_retailer(retailer: str | None) -> bool:
    name = normalize_retailer_name(retailer)

    if not name:
        return False

    return any(
        normalize_retailer_name(alias) in name
        for alias in INDIAN_RETAILER_ALIASES
    )



def _request_results(query: str, api_key: str) -> list[dict]:
    try:
        response = requests.get(
            SERPAPI_URL,
            params={
                "engine": "google_shopping",
                "q": query,
                "api_key": api_key,
                "gl": "in",
                "hl": "en",
                "location": "India",
                "num": MAX_RESULTS,
            },
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        data = response.json()

    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response else "unknown"
        raise ProductSearchError(
            f"SerpApi returned HTTP {status} for query: {query}"
        ) from exc
    except requests.Timeout as exc:
        raise ProductSearchError(
            f"SerpApi timed out for query: {query}"
        ) from exc
    except requests.RequestException as exc:
        raise ProductSearchError(
            f"Could not connect to SerpApi: {exc}"
        ) from exc
    except ValueError as exc:
        raise ProductSearchError(
            "SerpApi returned invalid JSON."
        ) from exc

    if data.get("error"):
        raise ProductSearchError(str(data["error"]))

    results = data.get("shopping_results", [])

    if isinstance(results, list):
        for item in results[:5]:
            print("\n--- GOOGLE SHOPPING RESULT ---")
            print("Title:", item.get("title"))
            print("Source:", item.get("source"))
            print("Price:", item.get("extracted_price"))
            print("Product ID:", item.get("product_id"))
            print("Multiple sources:", item.get("multiple_sources"))

    return results

    return []


def _valid_numeric_price(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
        return float(value)
    return None


def _discount_percent(original_price, current_price):
    if original_price and current_price and original_price > current_price:
        return round((original_price - current_price) / original_price * 100, 1)
    return None


def _discount_warning(original_price, current_price):
    # This is a heuristic flag, not proof of fraud. Historical observations
    # are required to confirm whether a reference price was artificially raised.
    if not original_price or not current_price or original_price <= current_price:
        return {"status": "not_detected", "message": "No comparable markdown was reported."}
    discount = (original_price - current_price) / original_price * 100
    if discount >= 60:
        return {"status": "suspicious_claim", "message": "Very large claimed discount; compare against recorded price history before trusting it."}
    return {"status": "claimed_discount_unverified", "message": "The listed original price has not been independently verified against historical prices."}



def _convert_result(item: dict) -> dict | None:
    title = (item.get("title") or "").strip()
    retailer = (item.get("source") or "").strip()

    # Collect possible links, preferring a genuine retailer URL.
    candidates = [
        item.get("link"),
        item.get("product_link"),
    ]

    url = None
    link_type = "shopping_result"

    for candidate in candidates:
        if not isinstance(candidate, str) or not candidate.strip():
            continue

        parsed = urlparse(candidate.strip())
        hostname = (parsed.hostname or "").lower()

        if parsed.scheme not in {"http", "https"} or not hostname:
            continue

        # Never treat a Google/SerpApi URL as a direct retailer link.
        if (
            hostname == "google.com"
            or hostname.endswith(".google.com")
            or hostname == "google.co.in"
            or hostname.endswith(".google.co.in")
            or hostname == "serpapi.com"
            or hostname.endswith(".serpapi.com")
        ):
            continue

        url = candidate.strip()
        link_type = "retailer_direct"
        break

    # If no direct retailer URL exists, retain the available result link.
    # The frontend can label this as a Shopping result instead of pretending
    # it is a direct retailer product page.
    if url is None:
        for candidate in candidates:
            if not isinstance(candidate, str) or not candidate.strip():
                continue

            parsed = urlparse(candidate.strip())
            if (
                parsed.scheme in {"http", "https"}
                and parsed.hostname
            ):
                url = candidate.strip()
                break

    if not title or not url:
        return None

    raw_price = item.get("extracted_price")
    price = _valid_numeric_price(raw_price)

    original_price = _valid_numeric_price(
        item.get("extracted_old_price")
    )

    return {
        "title": title,
        "retailer": retailer or "Unknown retailer",
        "price": price,
        "original_price": original_price,
        "currency": "INR" if price is not None else None,
        "url": url,
        "link_type": link_type,
        "image_url": item.get("thumbnail"),
        "price_status": (
            "provider_reported" if price is not None else "unavailable"
        ),
        "discount_percent": _discount_percent(original_price, price),
        "discount_warning": _discount_warning(original_price, price),
        "source": "Google Shopping via SerpApi",
    }




def _query_matches_title(query: str, title: str) -> bool:
    """Allow title variations without ignoring important model numbers."""
    query_tokens = {
        token
        for token in normalize_text(query).split()
        if token not in STOP_WORDS
    }
    title_tokens = set(normalize_text(title).split())

    if not query_tokens:
        return True

    # Only enforce numeric identifiers when the query appears to identify
    # a specific model, rather than containing an ordinary quantity.
    critical_tokens = {
        token for token in query_tokens
        if any(char.isdigit() for char in token)
    }

    if not critical_tokens.issubset(title_tokens):
        return False

    ordinary_tokens = query_tokens - critical_tokens

    if not ordinary_tokens:
        return True

    matched = len(ordinary_tokens & title_tokens)
    return matched / len(ordinary_tokens) >= 0.5


def _listing_identity(result: dict) -> tuple:
    """
    Google Shopping URLs often differ only because the search query differs.
    Use provider product identifiers when available.
    """
    parsed = urlparse(result["url"])
    params = parse_qs(parsed.query)

    prds = params.get("prds", [""])[0]
    provider_params = parse_qs(prds)

    provider_id = (
        provider_params.get("productid", [""])[0]
        or provider_params.get("headlineOfferDocid", [""])[0]
        or provider_params.get("catalogid", [""])[0]
    )

    retailer = normalize_retailer_name(result.get("retailer"))
    title = normalize_text(result.get("title"))

    if provider_id:
        return retailer, provider_id

    return retailer, title


def search_external_products(
    query: str,
    limit: int = MAX_RESULTS,
) -> list[dict]:
    api_key = os.getenv("SERPAPI_KEY")

    if not api_key:
        raise ProductSearchError(
            "SERPAPI_KEY is missing. Check backend/.env."
        )

    query = query.strip()

    if len(query) < 2:
        return []

    limit = max(1, min(int(limit), MAX_RESULTS))

    # One provider request per user search to preserve the limited API quota.
    queries = [query]

    collected = {}
    failures = []

    for search_query in queries:
        try:
            items = _request_results(search_query, api_key)
        except ProductSearchError as exc:
            failures.append(str(exc))
            continue

        for item in items:
            if not isinstance(item, dict):
                continue

            result = _convert_result(item)

            if not result:
                continue

            # Reject products that don't contain the requested search terms.
            if not _query_matches_title(query, result["title"]):
                continue

            # Google Shopping has already returned shopping listings for India.
            # Keep results from different retailers instead of discarding
            # every source that isn't in our manually maintained allowlist.
            if not result.get("retailer") or result["retailer"] == "Unknown retailer":
                continue
            identity = _listing_identity(result)
            previous = collected.get(identity)

            # Keep the lowest valid reported price for a duplicate listing.
            if previous is None:
                collected[identity] = result
            elif (
                result["price"] is not None
                and (
                    previous["price"] is None
                    or result["price"] < previous["price"]
                )
            ):
                collected[identity] = result

    if not collected and failures:
        raise ProductSearchError(
            "External searches failed. " + " | ".join(failures)
        )

    results = list(collected.values())

    results.sort(
        key=lambda item: (
            not is_indian_retailer(item["retailer"]),
            item["price"] is None,
            item["price"] if item["price"] is not None else float("inf"),
            normalize_text(item["title"]),
        )
    )

    return results[:limit]
