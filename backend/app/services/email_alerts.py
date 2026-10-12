"""SMTP email alerts. Configure SMTP_* environment variables to enable delivery."""
import os
import smtplib
from email.message import EmailMessage


def send_price_alert(to_email: str, title: str, price: float, target: float | None = None) -> bool:
    host = os.getenv("SMTP_HOST")
    username = os.getenv("SMTP_USERNAME")
    password = os.getenv("SMTP_PASSWORD")
    sender = os.getenv("SMTP_FROM") or username
    if not all([host, username, password, sender, to_email]):
        return False

    port = int(os.getenv("SMTP_PORT", "587"))
    msg = EmailMessage()
    msg["Subject"] = f"Price alert: {title[:90]}"
    msg["From"] = sender
    msg["To"] = to_email
    target_text = f" Your target price is ₹{target:,.0f}." if target else ""
    msg.set_content(
        f"Good news! The latest observed price for {title} is ₹{price:,.0f}.{target_text}\n\n"
        "Prices may change. Please open the retailer link in Price Tracker to confirm the offer."
    )
    try:
        with smtplib.SMTP(host, port, timeout=12) as server:
            server.starttls()
            server.login(username, password)
            server.send_message(msg)
        return True
    except (OSError, smtplib.SMTPException):
        return False
