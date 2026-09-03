from django.urls import path

from .views import MeView, SetPasswordView

urlpatterns = [
    path("me/", MeView.as_view(), name="me"),
    path("me/set-password/", SetPasswordView.as_view(), name="set-password"),
]
