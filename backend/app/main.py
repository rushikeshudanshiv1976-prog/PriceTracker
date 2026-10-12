
import logging
import os
from contextlib import asynccontextmanager
from importlib import import_module

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from app.database import Base, engine
from app import models  # Register ORM models before create_all.
from app.routes import auth, products

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Keep the API process alive when PostgreSQL is temporarily unavailable.
    # Requests that need the DB will return errors, and logs retain the cause.
    try:
        Base.metadata.create_all(bind=engine)
    except Exception:
        logging.getLogger(__name__).exception(
            "Database initialization failed; "
            "check DATABASE_URL and PostgreSQL availability"
        )

    scheduler = None

    try:
        try:
            from apscheduler.schedulers.background import BackgroundScheduler
        except ImportError:
            BackgroundScheduler = None

        from app.services.background_jobs import refresh_tracked_prices

        if BackgroundScheduler is not None:
            scheduler = BackgroundScheduler(timezone="Asia/Kolkata")

            scheduler.add_job(
                refresh_tracked_prices,
                "interval",
                hours=int(os.getenv("PRICE_REFRESH_HOURS", "12")),
                id="refresh_tracked_prices",
                max_instances=1,
                coalesce=True,
            )

            if os.getenv(
                "ENABLE_PRICE_SCHEDULER", "true"
            ).lower() in {"1", "true", "yes"}:
                scheduler.start()
        else:
            logging.getLogger(__name__).warning(
                "APScheduler is not installed; "
                "price refresh scheduler disabled"
            )

    except Exception:
        logging.getLogger(__name__).exception(
            "Price scheduler could not start"
        )

    yield

    if scheduler and scheduler.running:
        scheduler.shutdown(wait=False)


app = FastAPI(
    title="Price Tracker API",
    version="1.0.0",
    lifespan=lifespan,
)

allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:5173,"
        "http://127.0.0.1:5173,"
        "http://localhost:3000",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=[
        "GET",
        "POST",
        "PATCH",
        "DELETE",
        "OPTIONS",
    ],
    allow_headers=[
        "Authorization",
        "Content-Type",
    ],
)

app.include_router(auth.router)
app.include_router(products.router)


@app.get("/")
def read_root():
    return {
        "message": "Price Tracker API is running",
        "version": app.version,
        "docs": "/docs",
    }
