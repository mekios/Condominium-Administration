from django.core import mail
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.invite import invite_user
from accounts.models import User
from accounts.password_reset import encode_uid, password_reset_token_generator


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    FRONTEND_LOGIN_URL="http://localhost:8081/login",
)
class InviteFlowTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin_test",
            password="pass1234",
            role=User.Role.ADMINISTRATOR,
        )

    def test_invite_user_sets_flag_and_sends_email(self):
        user = User.objects.create_user(username="invited", email="invited@example.com", password="unused")
        success, _message = invite_user(user)

        user.refresh_from_db()
        self.assertTrue(success)
        self.assertTrue(user.must_change_password)
        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertIn("invited", message.body)
        self.assertIn("http://localhost:8081/login", message.body)
        self.assertTrue(message.alternatives)
        html_body, html_type = message.alternatives[0]
        self.assertEqual(html_type, "text/html")
        self.assertIn("Πρόσκληση σύνδεσης", html_body)
        self.assertIn("http://localhost:8081/login", html_body)
        self.assertIn("invited", html_body)
        self.assertTrue(any(getattr(part, "get_content_type", lambda: "")() == "image/png" for part in message.attachments))

    def test_invite_user_requires_email(self):
        user = User.objects.create_user(username="noemail", email="", password="unused")
        success, message = invite_user(user)

        self.assertFalse(success)
        self.assertIn("email", message.lower())
        self.assertEqual(len(mail.outbox), 0)

    def test_set_password_clears_flag(self):
        user = User.objects.create_user(
            username="changeme",
            email="changeme@example.com",
            password="TempPass123",
            must_change_password=True,
        )
        self.client.force_authenticate(user=user)

        response = self.client.post(
            reverse("set-password"),
            {
                "current_password": "TempPass123",
                "new_password": "StrongPass456!",
                "new_password_confirm": "StrongPass456!",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        user.refresh_from_db()
        self.assertFalse(user.must_change_password)
        self.assertTrue(user.check_password("StrongPass456!"))

    def test_set_password_rejects_weak_password(self):
        user = User.objects.create_user(
            username="weakpass",
            email="weak@example.com",
            password="TempPass123",
            must_change_password=True,
        )
        self.client.force_authenticate(user=user)

        response = self.client.post(
            reverse("set-password"),
            {
                "current_password": "TempPass123",
                "new_password": "123",
                "new_password_confirm": "123",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("new_password", response.data)

    def test_set_password_rejects_mismatch(self):
        user = User.objects.create_user(
            username="mismatch",
            email="mismatch@example.com",
            password="TempPass123",
            must_change_password=True,
        )
        self.client.force_authenticate(user=user)

        response = self.client.post(
            reverse("set-password"),
            {
                "current_password": "TempPass123",
                "new_password": "StrongPass456!",
                "new_password_confirm": "OtherPass789!",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_set_password_rejects_same_as_current(self):
        user = User.objects.create_user(
            username="samepass",
            email="same@example.com",
            password="TempPass123",
            must_change_password=True,
        )
        self.client.force_authenticate(user=user)

        response = self.client.post(
            reverse("set-password"),
            {
                "current_password": "TempPass123",
                "new_password": "TempPass123",
                "new_password_confirm": "TempPass123",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("new_password", response.data)

    def test_change_password_when_flag_already_cleared(self):
        user = User.objects.create_user(
            username="voluntary",
            email="voluntary@example.com",
            password="CurrentPass123!",
            must_change_password=False,
        )
        self.client.force_authenticate(user=user)

        response = self.client.post(
            reverse("set-password"),
            {
                "current_password": "CurrentPass123!",
                "new_password": "ChangedPass456!",
                "new_password_confirm": "ChangedPass456!",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        user.refresh_from_db()
        self.assertTrue(user.check_password("ChangedPass456!"))
        self.assertFalse(user.must_change_password)

    def test_blocked_api_access_when_must_change_password(self):
        user = User.objects.create_user(
            username="locked",
            email="locked@example.com",
            password="TempPass123",
            must_change_password=True,
        )
        self.client.force_authenticate(user=user)

        response = self.client.get("/api/apartments/")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_me_and_set_password_allowed_while_flag_set(self):
        user = User.objects.create_user(
            username="allowed",
            email="allowed@example.com",
            password="TempPass123",
            must_change_password=True,
        )
        self.client.force_authenticate(user=user)

        me_response = self.client.get(reverse("me"))
        self.assertEqual(me_response.status_code, status.HTTP_200_OK)
        self.assertTrue(me_response.data["must_change_password"])

    def test_resend_invite_invalidates_old_password(self):
        user = User.objects.create_user(username="resend", email="resend@example.com", password="unused")
        invite_user(user)
        old_password = mail.outbox[0].body.split("Προσωρινός κωδικός: ")[1].split("\n")[0]

        invite_user(user)
        new_password = mail.outbox[1].body.split("Προσωρινός κωδικός: ")[1].split("\n")[0]

        user.refresh_from_db()
        self.assertTrue(user.check_password(new_password))
        self.assertFalse(user.check_password(old_password))


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    FRONTEND_LOGIN_URL="http://localhost:8081/login",
)
class PasswordResetFlowTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="resetme",
            email="resetme@example.com",
            password="OldPass123!",
        )

    def test_forgot_password_sends_email_for_known_user(self):
        response = self.client.post(
            reverse("forgot-password"),
            {"identifier": "resetme@example.com"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("email", response.data["detail"].lower())
        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertEqual(message.to, ["resetme@example.com"])
        self.assertIn("/reset-password?uid=", message.body)
        self.assertTrue(message.alternatives)
        html_body, html_type = message.alternatives[0]
        self.assertEqual(html_type, "text/html")
        self.assertIn("Επαναφορά κωδικού", html_body)
        self.assertIn("/reset-password?uid=", html_body)

    def test_forgot_password_accepts_username(self):
        response = self.client.post(
            reverse("forgot-password"),
            {"identifier": "resetme"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 1)

    def test_forgot_password_unknown_identifier_is_silent(self):
        response = self.client.post(
            reverse("forgot-password"),
            {"identifier": "nobody@example.com"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 0)

    def test_reset_password_with_valid_token(self):
        uid = encode_uid(self.user)
        token = password_reset_token_generator.make_token(self.user)
        response = self.client.post(
            reverse("reset-password"),
            {
                "uid": uid,
                "token": token,
                "new_password": "NewPass123!",
                "new_password_confirm": "NewPass123!",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("NewPass123!"))
        self.assertFalse(self.user.must_change_password)

    def test_reset_password_rejects_invalid_token(self):
        uid = encode_uid(self.user)
        response = self.client.post(
            reverse("reset-password"),
            {
                "uid": uid,
                "token": "invalid-token",
                "new_password": "NewPass123!",
                "new_password_confirm": "NewPass123!",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("OldPass123!"))

    def test_reset_password_rejects_mismatched_confirmation(self):
        uid = encode_uid(self.user)
        token = password_reset_token_generator.make_token(self.user)
        response = self.client.post(
            reverse("reset-password"),
            {
                "uid": uid,
                "token": token,
                "new_password": "NewPass123!",
                "new_password_confirm": "OtherPass123!",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
