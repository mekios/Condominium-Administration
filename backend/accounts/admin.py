from django.contrib import admin, messages
from django.contrib.auth.admin import UserAdmin
from django.utils.translation import gettext_lazy as _

from flats.admin import ApartmentUserInline

from .forms import InviteUserCreationForm
from .invite import invite_user
from .models import User


@admin.register(User)
class AppUserAdmin(UserAdmin):
    list_display = (*UserAdmin.list_display, "role", "must_change_password", "apartment_count")
    list_filter = (*UserAdmin.list_filter, "role", "must_change_password")
    search_fields = UserAdmin.search_fields
    ordering = UserAdmin.ordering
    inlines = (ApartmentUserInline,)
    actions = ("send_invite_email",)
    add_form = InviteUserCreationForm

    fieldsets = (
        (None, {"fields": ("username", "password")}),
        (_("Personal info"), {"fields": ("first_name", "last_name", "email")}),
        (
            "Ρόλος εφαρμογής",
            {
                "fields": ("role", "preferred_language", "must_change_password"),
                "description": "Επίλεξε «Administrator» για διαχειριστή πολυκατοικίας.",
            },
        ),
        (
            _("Permissions"),
            {
                "fields": (
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                ),
            },
        ),
        (_("Important dates"), {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("username", "email", "first_name", "last_name"),
                "description": "Ο προσωρινός κωδικός θα αποσταλεί στο email.",
            },
        ),
        (
            "Ρόλος εφαρμογής",
            {
                "fields": ("role", "preferred_language"),
                "description": "Επίλεξε «Administrator» για διαχειριστή πολυκατοικίας.",
            },
        ),
    )

    @admin.display(description="Apartments")
    def apartment_count(self, obj: User) -> int:
        return obj.apartment_memberships.count()

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        if not change:
            success, message = invite_user(obj)
            level = messages.SUCCESS if success else messages.ERROR
            self.message_user(request, message, level=level)

    @admin.action(description="Αποστολή πρόσκλησης (νέος προσωρινός κωδικός)")
    def send_invite_email(self, request, queryset):
        for user in queryset:
            success, message = invite_user(user)
            level = messages.SUCCESS if success else messages.ERROR
            self.message_user(request, message, level=level)
