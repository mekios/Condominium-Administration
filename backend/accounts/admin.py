from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from flats.admin import ApartmentUserInline

from .models import User


@admin.register(User)
class AppUserAdmin(UserAdmin):
    list_display = (*UserAdmin.list_display, "role", "apartment_count")
    list_filter = (*UserAdmin.list_filter, "role")
    search_fields = UserAdmin.search_fields
    ordering = UserAdmin.ordering
    inlines = (ApartmentUserInline,)

    fieldsets = (
        *UserAdmin.fieldsets,
        ("App access", {"fields": ("role", "preferred_language")}),
    )
    add_fieldsets = (
        *UserAdmin.add_fieldsets,
        ("App access", {"fields": ("role", "preferred_language")}),
    )

    @admin.display(description="Apartments")
    def apartment_count(self, obj: User) -> int:
        return obj.apartment_memberships.count()
