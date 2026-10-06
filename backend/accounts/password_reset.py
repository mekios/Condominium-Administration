from django.conf import settings
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode

from .emailing import frontend_origin, send_branded_email
from .models import User

password_reset_token_generator = PasswordResetTokenGenerator()


def encode_uid(user: User) -> str:
    return urlsafe_base64_encode(force_bytes(user.pk))


def decode_uid(uidb64: str) -> int | None:
    try:
        return int(force_str(urlsafe_base64_decode(uidb64)))
    except (TypeError, ValueError, OverflowError):
        return None


def build_reset_url(user: User, token: str) -> str:
    return f"{frontend_origin()}/reset-password?uid={encode_uid(user)}&token={token}"


def find_user_for_password_reset(*, identifier: str) -> User | None:
    value = (identifier or "").strip()
    if not value:
        return None
    by_email = User.objects.filter(email__iexact=value).order_by("id").first()
    if by_email:
        return by_email
    return User.objects.filter(username__iexact=value).first()


def send_password_reset_email(user: User) -> None:
    token = password_reset_token_generator.make_token(user)
    reset_url = build_reset_url(user, token)
    first_name = (user.first_name or "").strip()
    subject = "Επαναφορά κωδικού — Διαχείριση πολυκατοικίας"
    text_body = (
        f"Γεια σας{f' {first_name}' if first_name else ''},\n\n"
        "Λάβαμε αίτημα επαναφοράς κωδικού για τον λογαριασμό σας.\n\n"
        f"Ακολουθήστε τον σύνδεσμο για να ορίσετε νέο κωδικό:\n{reset_url}\n\n"
        "Ο σύνδεσμος ισχύει για περιορισμένο χρόνο. "
        "Αν δεν ζητήσατε εσείς την επαναφορά, αγνοήστε αυτό το μήνυμα.\n"
    )
    send_branded_email(
        subject=subject,
        to=user.email,
        text_body=text_body,
        template_name="accounts/emails/password_reset.html",
        context={
            "first_name": first_name,
            "username": user.username,
            "reset_url": reset_url,
        },
    )


def resolve_user_from_reset(uidb64: str, token: str) -> User | None:
    user_id = decode_uid(uidb64)
    if user_id is None:
        return None
    user = User.objects.filter(pk=user_id).first()
    if not user:
        return None
    if not password_reset_token_generator.check_token(user, token):
        return None
    return user
