from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .password_reset import (
    find_user_for_password_reset,
    resolve_user_from_reset,
    send_password_reset_email,
)
from .permissions import MustChangePasswordComplete
from .serializers import (
    ForgotPasswordSerializer,
    MeSerializer,
    ResetPasswordSerializer,
    SetPasswordSerializer,
)


class MeView(APIView):
    permission_classes = [IsAuthenticated, MustChangePasswordComplete]

    def get(self, request):
        data = {
            "id": request.user.id,
            "username": request.user.username,
            "first_name": request.user.first_name,
            "last_name": request.user.last_name,
            "email": request.user.email,
            "role": request.user.role,
            "preferred_language": request.user.preferred_language,
            "must_change_password": request.user.must_change_password,
        }
        serializer = MeSerializer(data)
        return Response(serializer.data)


class SetPasswordView(APIView):
    permission_classes = [IsAuthenticated, MustChangePasswordComplete]

    def post(self, request):
        user = request.user
        serializer = SetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        current_password = serializer.validated_data["current_password"]
        new_password = serializer.validated_data["new_password"]

        if not user.check_password(current_password):
            return Response(
                {"current_password": ["Ο τρέχων κωδικός είναι λανθασμένος."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if user.check_password(new_password):
            return Response(
                {"new_password": ["Ο νέος κωδικός πρέπει να διαφέρει από τον τρέχοντα."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            validate_password(new_password, user)
        except DjangoValidationError as exc:
            return Response(
                {"new_password": list(exc.messages)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(new_password)
        user.must_change_password = False
        user.save(update_fields=["password", "must_change_password"])
        return Response({"detail": "Ο κωδικός ενημερώθηκε."})


class ForgotPasswordView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        serializer = ForgotPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        identifier = serializer.validated_data["identifier"]
        user = find_user_for_password_reset(identifier=identifier)

        # Always return the same message to avoid account enumeration.
        detail = (
            "Αν υπάρχει λογαριασμός με αυτά τα στοιχεία, θα λάβετε email "
            "με οδηγίες επαναφοράς κωδικού."
        )

        if user and (user.email or "").strip():
            try:
                send_password_reset_email(user)
            except Exception:
                return Response(
                    {"detail": "Αποτυχία αποστολής email. Δοκιμάστε ξανά αργότερα."},
                    status=status.HTTP_502_BAD_GATEWAY,
                )

        return Response({"detail": detail})


class ResetPasswordView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        serializer = ResetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        uid = serializer.validated_data["uid"]
        token = serializer.validated_data["token"]
        new_password = serializer.validated_data["new_password"]

        user = resolve_user_from_reset(uid, token)
        if not user:
            return Response(
                {"detail": "Ο σύνδεσμος επαναφοράς δεν είναι έγκυρος ή έχει λήξει."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            validate_password(new_password, user)
        except DjangoValidationError as exc:
            return Response(
                {"new_password": list(exc.messages)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(new_password)
        user.must_change_password = False
        user.save(update_fields=["password", "must_change_password"])
        return Response({"detail": "Ο κωδικός ενημερώθηκε. Μπορείτε να συνδεθείτε."})
