from rest_framework.permissions import BasePermission


class MustChangePasswordComplete(BasePermission):
    message = "Πρέπει να ορίσετε νέο κωδικό πρόσβασης πριν συνεχίσετε."

    ALLOWLIST_PREFIXES = (
        "/api/me",
        "/api/token/refresh",
    )

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not user or not user.is_authenticated:
            return True
        if not getattr(user, "must_change_password", False):
            return True

        path = request.path.rstrip("/") or "/"
        for prefix in self.ALLOWLIST_PREFIXES:
            if path == prefix.rstrip("/") or path.startswith(f"{prefix.rstrip('/')}/"):
                return True
        return False
