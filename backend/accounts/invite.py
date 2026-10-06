import secrets
import string

from .emailing import send_branded_email


def generate_temporary_password(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits
    alphabet = alphabet.replace("O", "").replace("0", "").replace("l", "").replace("I", "")
    return "".join(secrets.choice(alphabet) for _ in range(length))


def send_user_invite(user, *, temporary_password: str) -> None:
    from django.conf import settings

    login_url = settings.FRONTEND_LOGIN_URL
    subject = "Πρόσκληση σύνδεσης — Διαχείριση πολυκατοικίας"
    first_name = (user.first_name or "").strip()
    text_body = (
        f"Γεια σας{f' {first_name}' if first_name else ''},\n\n"
        "Δημιουργήθηκε λογαριασμός για την εφαρμογή διαχείρισης πολυκατοικίας.\n\n"
        f"Διεύθυνση σύνδεσης: {login_url}\n"
        f"Όνομα χρήστη: {user.username}\n"
        f"Προσωρινός κωδικός: {temporary_password}\n\n"
        "Στην πρώτη σύνδεση θα σας ζητηθεί να ορίσετε νέο, ισχυρό κωδικό πρόσβασης.\n\n"
        "Αν δεν αναμένατε αυτό το μήνυμα, επικοινωνήστε με τον διαχειριστή."
    )
    send_branded_email(
        subject=subject,
        to=user.email,
        text_body=text_body,
        template_name="accounts/emails/invite.html",
        context={
            "first_name": first_name,
            "username": user.username,
            "temporary_password": temporary_password,
            "login_url": login_url,
        },
    )


def invite_user(user) -> tuple[bool, str]:
    email_addr = (user.email or "").strip()
    if not email_addr:
        return False, f"Ο χρήστης {user.username} δεν έχει email — η πρόσκληση δεν αποστάλθηκε."

    temporary_password = generate_temporary_password()
    user.set_password(temporary_password)
    user.must_change_password = True
    user.save(update_fields=["password", "must_change_password"])

    try:
        send_user_invite(user, temporary_password=temporary_password)
    except Exception as exc:
        return False, f"Αποτυχία αποστολής email στον {user.username}: {exc}"

    return True, f"Η πρόσκληση στάλθηκε στο {email_addr} για τον χρήστη {user.username}."
