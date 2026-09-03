import secrets
import string

from django.conf import settings
from django.core.mail import EmailMessage


def generate_temporary_password(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits
    alphabet = alphabet.replace("O", "").replace("0", "").replace("l", "").replace("I", "")
    return "".join(secrets.choice(alphabet) for _ in range(length))


def send_user_invite(user, *, temporary_password: str) -> None:
    login_url = settings.FRONTEND_LOGIN_URL
    subject = "Πρόσκληση σύνδεσης — Διαχείριση πολυκατοικίας"
    body = (
        f"Γεια σας{f' {user.first_name}' if user.first_name else ''},\n\n"
        "Δημιουργήθηκε λογαριασμός για την εφαρμογή διαχείρισης πολυκατοικίας.\n\n"
        f"Διεύθυνση σύνδεσης: {login_url}\n"
        f"Όνομα χρήστη: {user.username}\n"
        f"Προσωρινός κωδικός: {temporary_password}\n\n"
        "Στην πρώτη σύνδεση θα σας ζητηθεί να ορίσετε νέο, ισχυρό κωδικό πρόσβασης.\n\n"
        "Αν δεν αναμένατε αυτό το μήνυμα, επικοινωνήστε με τον διαχειριστή."
    )
    email = EmailMessage(
        subject=subject,
        body=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[user.email],
    )
    email.send(fail_silently=False)


def invite_user(user) -> tuple[bool, str]:
    email = (user.email or "").strip()
    if not email:
        return False, f"Ο χρήστης {user.username} δεν έχει email — η πρόσκληση δεν αποστάλθηκε."

    temporary_password = generate_temporary_password()
    user.set_password(temporary_password)
    user.must_change_password = True
    user.save(update_fields=["password", "must_change_password"])

    try:
        send_user_invite(user, temporary_password=temporary_password)
    except Exception as exc:
        return False, f"Αποτυχία αποστολής email στον {user.username}: {exc}"

    return True, f"Η πρόσκληση στάλθηκε στο {email} για τον χρήστη {user.username}."
