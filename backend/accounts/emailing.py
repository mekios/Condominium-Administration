import email.utils
from email.message import MIMEPart
from pathlib import Path

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string

LOGO_PATH = Path(__file__).resolve().parent.parent / "flats" / "assets" / "logo.png"


def frontend_origin() -> str:
    login_url = settings.FRONTEND_LOGIN_URL.rstrip("/")
    if login_url.endswith("/login"):
        return login_url[: -len("/login")]
    return login_url.rsplit("/", 1)[0] if "/" in login_url else login_url


def send_branded_email(*, subject: str, to: str, text_body: str, template_name: str, context: dict) -> None:
    logo_cid = email.utils.make_msgid(domain="building.local")
    html_context = {
        **context,
        "subject": subject,
        "logo_cid": logo_cid[1:-1],
    }
    html_body = render_to_string(template_name, html_context)

    message = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[to],
    )
    message.attach_alternative(html_body, "text/html")

    if LOGO_PATH.is_file():
        inline_logo = MIMEPart()
        inline_logo.set_content(
            LOGO_PATH.read_bytes(),
            maintype="image",
            subtype="png",
            disposition="inline",
            filename="logo.png",
            cid=logo_cid,
        )
        message.attach(inline_logo)

    message.send(fail_silently=False)
