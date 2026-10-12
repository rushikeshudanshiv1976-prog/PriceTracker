from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from datetime import datetime
from app.models import ProductOffer, OfferPriceHistory

from app.database import get_db
from app.security import get_current_user

from datetime import datetime
from urllib.parse import urlparse

from pydantic import BaseModel, HttpUrl, Field

from app.models import (
    Product,
    ProductOffer,
    OfferPriceHistory,
    PriceHistory,
    Subscription,
    User,
)

from app.services.scraper import scrape_product_page

from fastapi import HTTPException
from app.services.product_search import (
    ProductSearchError,
    search_external_products,
)
from app.services.product_comparison import compare_product_offers
from app.services.email_alerts import send_price_alert

router = APIRouter(prefix="/api/products", tags=["Products"])


class IngestProductRequest(BaseModel):
    url: HttpUrl


class ExternalTrackRequest(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    url: HttpUrl
    retailer: str = Field(min_length=1, max_length=120)
    price: float | None = Field(default=None, gt=0)
    image_url: HttpUrl | None = None
    target_price: float | None = Field(default=None, gt=0)


class TargetPriceRequest(BaseModel):
    target_price: float | None = Field(default=None, gt=0)



def product_payload(product: Product) -> dict[str, Any]:
    return {
        "id": product.id,
        "title": product.title,
        "image_url": product.image_url,
        "retailer": product.retailer,
        "current_price": product.current_price,
        "url": product.url,
        "price_status": "unverified" if product.current_price is None else "stored",
    }


@router.get("/search")
def search_products(
    q: str = Query(min_length=1, max_length=120),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """Search products already in the catalog; no fake products/prices are generated."""
    term = q.strip()
    if not term:
        return []
    products = (
        db.query(Product)
        .filter(Product.title.ilike(f"%{term}%"))
        .order_by(Product.title.asc())
        .limit(limit)
        .all()
    )
    return [product_payload(product) for product in products]


@router.post("/{product_id}/track", status_code=status.HTTP_201_CREATED)
def track_product(
    product_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found in the catalog")

    existing = db.query(Subscription).filter(
        Subscription.user_email == current_user.email,
        Subscription.product_id == product_id,
    ).first()
    if existing:
        return {"message": "Product is already in your watchlist", "subscription_id": existing.id}

    subscription = Subscription(user_email=current_user.email, product_id=product_id)
    db.add(subscription)
    db.commit()
    db.refresh(subscription)
    return {"message": "Product added to your watchlist", "subscription_id": subscription.id}


@router.get("/watchlist")
def get_watchlist(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    subscriptions = db.query(Subscription).filter(
        Subscription.user_email == current_user.email
    ).all()
    result = []
    for sub in subscriptions:
        product = db.query(Product).filter(Product.id == sub.product_id).first()
        if product:
            item = product_payload(product)
            item.update({"subscription_id": sub.id, "target_price": sub.target_price})
            result.append(item)
    return result


@router.delete("/watchlist/{subscription_id}", status_code=status.HTTP_200_OK)
def remove_from_watchlist(
    subscription_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    subscription = db.query(Subscription).filter(
        Subscription.id == subscription_id,
        Subscription.user_email == current_user.email,
    ).first()
    if subscription is None:
        raise HTTPException(status_code=404, detail="Tracked product not found")
    db.delete(subscription)
    db.commit()
    return {"message": "Product removed from your watchlist"}


@router.get("/compare")
def compare_product_prices(
    q: str = Query(min_length=1, max_length=120),
    db: Session = Depends(get_db),
):
    """Compare stored retailer offers for matching catalog products."""
    term = q.strip()
    if not term:
        return {"query": term, "offers": []}

    products = (
        db.query(Product)
        .filter(Product.title.ilike(f"%{term}%"))
        .all()
    )

    if not products:
        return {"query": term, "offers": []}

    product_ids = [product.id for product in products]

    offers = (
        db.query(ProductOffer)
        .filter(ProductOffer.product_id.in_(product_ids))
        .all()
    )

    results = []
    for offer in offers:
        results.append({
            "offer_id": offer.id,
            "product_id": offer.product_id,
            "product_title": offer.product.title,
            "retailer": offer.retailer,
            "url": offer.url,
            "price": offer.current_price,
            "currency": offer.currency,
            "price_status": offer.price_status,
            "last_checked": (
                offer.last_checked.isoformat()
                if offer.last_checked else None
            ),
        })

    # Verified, available prices first; cheapest first within that group.
    results.sort(
        key=lambda item: (
            item["price"] is None
            or item["price_status"] != "verified",
            item["price"] if item["price"] is not None else float("inf"),
        )
    )

    return {
        "query": term,
        "offers": results,
        "offer_count": len(results),
    }


@router.post("/ingest", status_code=status.HTTP_201_CREATED)
def ingest_product(
    payload: IngestProductRequest,
    db: Session = Depends(get_db),
):
    """Retrieve metadata from a user-supplied product URL and store its offer."""
    url = str(payload.url)

    scraped = scrape_product_page(url)

    if scraped.get("status") == "error":
        raise HTTPException(
            status_code=422,
            detail=scraped.get("message", "Unable to retrieve product page"),
        )

    title = scraped.get("title")
    if not title or title == "Unknown product":
        raise HTTPException(
        status_code=422,
        detail=(
            scraped.get("message")
            or "Could not identify a product on this page. "
            "The retailer may block automated access. "
            "Try another supported product URL or data source."
        ),
    )

    final_url = scraped.get("url") or url
    retailer = (urlparse(final_url).hostname or "Unknown retailer").removeprefix("www.")
    price = scraped.get("current_price")

    # Reuse the product if this exact URL is already in the catalog.
    product = db.query(Product).filter(Product.url == final_url).first()

    if product is None:
        product = Product(
            title=title,
            image_url=scraped.get("image_url"),
            retailer=retailer,
            current_price=price,
            url=final_url,
        )
        db.add(product)
        db.flush()
    else:
        product.title = title
        product.image_url = scraped.get("image_url") or product.image_url
        product.retailer = retailer
        if price is not None:
            product.current_price = price

    offer = db.query(ProductOffer).filter(
        ProductOffer.url == final_url
    ).first()

    if offer is None:
        offer = ProductOffer(
            product_id=product.id,
            retailer=retailer,
            url=final_url,
            current_price=price,
            currency="INR",
            price_status="verified" if price is not None else "unavailable",
            last_checked=datetime.utcnow(),
        )
        db.add(offer)
    else:
        offer.current_price = price
        offer.price_status = "verified" if price is not None else "unavailable"
        offer.last_checked = datetime.utcnow()

    if price is not None:
        db.add(
            OfferPriceHistory(
                offer=offer,
                price=price,
                currency="INR",
            )
        )
        db.add(PriceHistory(product_id=product.id, price=price, recorded_at=datetime.utcnow()))

    try:
        db.commit()
        db.refresh(product)
        db.refresh(offer)
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Could not save the product. Check the database schema and server logs.",
        )

    return {
        "message": "Product metadata processed",
        "product_id": product.id,
        "offer_id": offer.id,
        "title": product.title,
        "retailer": retailer,
        "price": price,
        "price_status": offer.price_status,
        "url": final_url,
        "image_url": product.image_url,
    }


@router.get("/compare/external")
def compare_external_products(
    q: str = Query(min_length=2, max_length=120),
    limit: int = Query(default=20, ge=1, le=20),
):
    """Find matching products across retailers and rank their reported prices."""
    term = q.strip()

    if len(term) < 2:
        raise HTTPException(
            status_code=422,
            detail="Enter at least 2 characters to search.",
        )

    try:
        offers = search_external_products(term, limit)
    except ProductSearchError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    groups = compare_product_offers(offers)

    return {
        "query": term,
        "source": "Google Shopping via SerpApi",
        "result_count": len(groups),
        "groups": groups,
    }



@router.get("/search/external")
def search_external(
    q: str = Query(min_length=2, max_length=120),
    limit: int = Query(default=20, ge=1, le=20),
):
    """Search external shopping listings without inventing prices."""
    term = q.strip()

    if len(term) < 2:
        raise HTTPException(
            status_code=422,
            detail="Enter at least two characters.",
        )

    try:
        results = search_external_products(term, limit)
    except ProductSearchError as exc:
        raise HTTPException(
            status_code=502,
            detail=str(exc),
        ) from exc

    return {
        "query": term,
        "source": "Google Shopping via SerpApi",
        "results": results,
        "result_count": len(results),
    }


@router.post("/track-external", status_code=status.HTTP_201_CREATED)
def track_external_product(
    payload: ExternalTrackRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save an external search result, its observed offer, and the user's subscription."""
    url = str(payload.url)
    product = db.query(Product).filter(Product.url == url).first()
    if product is None:
        product = Product(
            title=payload.title,
            image_url=str(payload.image_url) if payload.image_url else None,
            retailer=payload.retailer,
            current_price=payload.price,
            url=url,
        )
        db.add(product)
        db.flush()
    else:
        product.title = payload.title
        product.image_url = str(payload.image_url) if payload.image_url else product.image_url
        product.retailer = payload.retailer
        if payload.price is not None:
            product.current_price = payload.price

    offer = db.query(ProductOffer).filter(ProductOffer.url == url).first()
    now = datetime.utcnow()
    if offer is None:
        offer = ProductOffer(
            product_id=product.id, retailer=payload.retailer, url=url,
            current_price=payload.price, currency="INR",
            price_status="provider_reported" if payload.price is not None else "unavailable",
            last_checked=now,
        )
        db.add(offer)
        db.flush()
    elif payload.price is not None:
        offer.current_price = payload.price
        offer.price_status = "provider_reported"
        offer.last_checked = now

    if payload.price is not None:
        db.add(PriceHistory(product_id=product.id, price=payload.price, recorded_at=now))
        db.add(OfferPriceHistory(offer_id=offer.id, price=payload.price, currency="INR", recorded_at=now))

    subscription = db.query(Subscription).filter(
        Subscription.user_email == current_user.email,
        Subscription.product_id == product.id,
    ).first()
    if subscription is None:
        subscription = Subscription(
            user_email=current_user.email,
            product_id=product.id,
            target_price=payload.target_price,
        )
        db.add(subscription)
    elif payload.target_price is not None:
        subscription.target_price = payload.target_price

    try:
        db.commit()
        db.refresh(product)
        db.refresh(subscription)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Could not save this product to your watchlist.") from exc

    return {
        "message": "Product is now tracked. Email alerts are sent when SMTP is configured and a later price check detects the target price.",
        "product_id": product.id,
        "subscription_id": subscription.id,
        "title": product.title,
    }


@router.patch("/watchlist/{subscription_id}/target")
def update_target_price(
    subscription_id: int,
    payload: TargetPriceRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    subscription = db.query(Subscription).filter(
        Subscription.id == subscription_id,
        Subscription.user_email == current_user.email,
    ).first()
    if subscription is None:
        raise HTTPException(status_code=404, detail="Tracked product not found")
    subscription.target_price = payload.target_price
    db.commit()
    return {"message": "Target price updated", "target_price": subscription.target_price}


@router.get("/watchlist/{subscription_id}/history")
def get_tracked_price_history(
    subscription_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    subscription = db.query(Subscription).filter(
        Subscription.id == subscription_id,
        Subscription.user_email == current_user.email,
    ).first()
    if subscription is None:
        raise HTTPException(status_code=404, detail="Tracked product not found")
    product = db.query(Product).filter(Product.id == subscription.product_id).first()
    rows = db.query(PriceHistory).filter(
        PriceHistory.product_id == subscription.product_id
    ).order_by(PriceHistory.recorded_at.asc()).all()
    values = [float(row.price) for row in rows]
    changes = [values[i] - values[i - 1] for i in range(1, len(values))]
    drops = [-value for value in changes if value < 0]
    rises = [value for value in changes if value > 0]
    return {
        "product_id": subscription.product_id,
        "title": product.title if product else "Tracked product",
        "history": [{"price": float(row.price), "recorded_at": row.recorded_at.isoformat()} for row in rows],
        "average_drop": round(sum(drops) / len(drops), 2) if drops else 0,
        "average_rise": round(sum(rises) / len(rises), 2) if rises else 0,
        "net_change": round(values[-1] - values[0], 2) if len(values) > 1 else 0,
        "message": "History starts when Price Tracker first records prices; older prices are not invented.",
    }
