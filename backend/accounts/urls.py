from django.urls import path

from .views import ForgotPasswordView, MeView, ResetPasswordView, SetPasswordView

urlpatterns = [
    path("me/", MeView.as_view(), name="me"),
    path("me/set-password/", SetPasswordView.as_view(), name="set-password"),
    path("auth/forgot-password/", ForgotPasswordView.as_view(), name="forgot-password"),
    path("auth/reset-password/", ResetPasswordView.as_view(), name="reset-password"),
]
