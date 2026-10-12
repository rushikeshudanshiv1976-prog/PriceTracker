"""Periodic refresh for tracked retailer product URLs (no SerpApi calls)."""
import logging
from datetime import datetime

from app.database import SessionLocal
from app.models import Product, ProductOffer, OfferPriceHistory, PriceHistory, Subscription
from app.services.scraper import scrape_product_page
from app.services.email_alerts import send_price_alert

logger = logging.getLogger(__name__)


def refresh_tracked_prices():
    db = SessionLocal()
    try:
        products = db.query(Product).filter(Product.url.isnot(None)).all()
        for product in products:
            try:
                result = scrape_product_page(product.url)
                price = result.get("current_price")
                if result.get("status") == "error" or not isinstance(price, (int, float)) or price <= 0:
                    continue
                old_price = product.current_price
                product.current_price = float(price)
                if result.get("title"):
                    product.title = result["title"]
                if result.get("image_url"):
                    product.image_url = result["image_url"]
                now = datetime.utcnow()
                db.add(PriceHistory(product_id=product.id, price=float(price), recorded_at=now))
                offers = db.query(ProductOffer).filter(ProductOffer.product_id == product.id).all()
                for offer in offers:
                    if offer.url == product.url:
                        offer.current_price = float(price)
                        offer.price_status = "observed"
                        offer.last_checked = now
                        db.add(OfferPriceHistory(offer_id=offer.id, price=float(price), currency=offer.currency or "INR", recorded_at=now))
                db.flush()
                subscriptions = db.query(Subscription).filter(Subscription.product_id == product.id).all()
                for sub in subscriptions:
                    reached_target = (
                        sub.target_price is not None
                        and old_price is not None
                        and float(old_price) > sub.target_price
                        and float(price) <= sub.target_price
                    )
                    dropped = old_price is not None and float(price) < float(old_price)
                    # Notify on target reached or a price decrease. A failed SMTP send is not fatal.
                    if reached_target or dropped:
                        send_price_alert(sub.user_email, product.title, float(price), sub.target_price)
            except Exception:
                logger.exception("Price refresh failed for product_id=%s", product.id)
                db.rollback()
        db.commit()
    finally:
        db.close()
