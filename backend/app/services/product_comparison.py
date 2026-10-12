
import re
from difflib import SequenceMatcher


def normalize_title(title: str) -> str:
    text = (title or "").lower()
    text = re.sub(r"\b(new|official|online|latest)\b", " ", text)
    text = re.sub(r"[^\w]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def title_tokens(title: str) -> set[str]:
    return set(normalize_title(title).split())


def _gpu(title: str) -> set[str]:
    text = normalize_title(title)
    found = set()

    for match in re.findall(
        r"\b(rtx|gtx|rx)\s*(\d{3,4})\b", text
    ):
        found.add("".join(match))

    return found


def _processor(title: str) -> set[str]:
    text = normalize_title(title)
    found = set()

    patterns = (
        r"\bcore\s*[3579]\s*\d{3,5}[a-z]*\b",
        r"\bi[3579]\s*\d{3,5}[a-z]*\b",
        r"\bryzen\s*[3579]\s*\d{3,5}[a-z]*\b",
    )

    for pattern in patterns:
        for match in re.findall(pattern, text):
            found.add(re.sub(r"\s+", "", match))

    return found


def _product_family(title: str) -> str | None:
    text = normalize_title(title)

    # Check more specific families before generic family names.
    patterns = (
        (r"\baspire\s*7\b", "aspire 7"),
        (r"\baspire\s*lite\b", "aspire lite"),
        (r"\baspire\s*3\b", "aspire 3"),
        (r"\baspire\b", "aspire"),
        (r"\balg\b", "alg"),
        (r"\bnitro\b", "nitro"),
        (r"\bpredator\b", "predator"),
        (r"\btravelmate\b", "travelmate"),
    )

    for pattern, family in patterns:
        if re.search(pattern, text):
            return family

    return None


def same_product(first: dict, second: dict) -> bool:
    a = normalize_title(first.get("title", ""))
    b = normalize_title(second.get("title", ""))

    if not a or not b:
        return False

    if a == b:
        return True

    family_a = _product_family(a)
    family_b = _product_family(b)

    # Don't merge known, different laptop families.
    if family_a and family_b and family_a != family_b:
        return False

    gpu_a = _gpu(a)
    gpu_b = _gpu(b)

    # Don't merge different GPUs when both listings specify one.
    if gpu_a and gpu_b and gpu_a != gpu_b:
        return False

    processor_a = _processor(a)
    processor_b = _processor(b)

    if (
        processor_a
        and processor_b
        and processor_a != processor_b
    ):
        return False

    tokens_a = title_tokens(a)
    tokens_b = title_tokens(b)

    overlap = len(tokens_a & tokens_b) / max(
        1, len(tokens_a | tokens_b)
    )
    similarity = SequenceMatcher(None, a, b).ratio()

    return overlap >= 0.75 or similarity >= 0.88


def _valid_price(offer: dict) -> bool:
    price = offer.get("price")

    return (
        isinstance(price, (int, float))
        and not isinstance(price, bool)
        and price > 0
    )


def compare_product_offers(results: list[dict]) -> list[dict]:
    groups = []

    for result in results:
        if not result.get("title") or not result.get("url"):
            continue

        matching_group = next(
            (
                group
                for group in groups
                if same_product(result, group["offers"][0])
            ),
            None,
        )

        if matching_group is None:
            matching_group = {
                "title": result["title"],
                "offers": [],
            }
            groups.append(matching_group)


        # Deduplicate only identical retailer + listing URL.
        retailer = (result.get("retailer") or "").strip().lower()
        url = (result.get("url") or "").strip().rstrip("?&")

        duplicate_index = next(
            (
                index
                for index, offer in enumerate(matching_group["offers"])
                if (offer.get("retailer") or "").strip().lower() == retailer
                and (offer.get("url") or "").strip().rstrip("?&") == url
            ),
            None,
        )

        if duplicate_index is not None:
            previous = matching_group["offers"][duplicate_index]

            if (
                _valid_price(result)
                and (
                    not _valid_price(previous)
                    or result["price"] < previous["price"]
                )
            ):
                matching_group["offers"][duplicate_index] = result

            continue

        matching_group["offers"].append(result)


    for group in groups:
        group["offers"].sort(
            key=lambda offer: (
                not _valid_price(offer),
                offer["price"] if _valid_price(offer) else float("inf"),
            )
        )

        priced_offers = [
            offer for offer in group["offers"]
            if _valid_price(offer)
        ]

        cheapest = priced_offers[0] if priced_offers else None

        group["lowest_price"] = cheapest["price"] if cheapest else None
        group["lowest_price_retailer"] = (
            cheapest["retailer"] if cheapest else None
        )
        group["offer_count"] = len(group["offers"])

    groups.sort(
        key=lambda group: (
            group["lowest_price"] is None,
            group["lowest_price"]
            if group["lowest_price"] is not None
            else float("inf"),
        )
    )

    return groups
