from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        SUPERADMIN = "superadmin", "Superadmin"
        ADMINISTRATOR = "administrator", "Administrator"
        USER = "user", "User"

    role = models.CharField(max_length=32, choices=Role.choices, default=Role.USER)
    preferred_language = models.CharField(max_length=8, default="el")
    must_change_password = models.BooleanField(default=False)

    def __str__(self) -> str:
        return f"{self.username} ({self.get_role_display()})"
