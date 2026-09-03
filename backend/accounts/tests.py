from django.core import mail
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.invite import invite_user
from accounts.models import User


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
        self.assertIn("invited", mail.outbox[0].body)
        self.assertIn("http://localhost:8081/login", mail.outbox[0].body)

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
