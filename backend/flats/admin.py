from django.contrib import admin

from .models import (
    Apartment,
    ApartmentUser,
    Building,
    BuildingMeasurementInput,
    DesignatedVoter,
    ExpenseItem,
    HeatingMeasurementInput,
    HeatedWaterMeasurementInput,
    Invoice,
)


class ApartmentUserInline(admin.TabularInline):
    model = ApartmentUser
    extra = 1
    autocomplete_fields = ("user",)
    fields = ("user", "is_tenant", "is_owner")
    verbose_name = "Linked user"
    verbose_name_plural = "Linked users (tenant / owner)"


class DesignatedVoterInline(admin.StackedInline):
    model = DesignatedVoter
    max_num = 1
    can_delete = True
    autocomplete_fields = ("voter_user",)
    fields = ("voter_user", "effective_from")


@admin.register(Building)
class BuildingAdmin(admin.ModelAdmin):
    search_fields = ("name",)
    list_display = ("name", "fund_balance", "created_at")
    fields = ("name", "fund_balance")


@admin.register(Apartment)
class ApartmentAdmin(admin.ModelAdmin):
    list_display = ("unit_code", "owner_name", "building", "ownership_permille", "member_count")
    list_filter = ("building",)
    search_fields = ("unit_code", "owner_name", "building__name")
    autocomplete_fields = ("building",)
    inlines = (ApartmentUserInline, DesignatedVoterInline)

    @admin.display(description="Linked users")
    def member_count(self, obj: Apartment) -> int:
        return obj.memberships.count()


@admin.register(ApartmentUser)
class ApartmentUserAdmin(admin.ModelAdmin):
    list_display = ("user", "apartment", "membership_role", "is_tenant", "is_owner", "updated_at")
    list_filter = ("is_tenant", "is_owner", "apartment__building")
    list_editable = ("is_tenant", "is_owner")
    search_fields = (
        "user__username",
        "user__email",
        "user__first_name",
        "user__last_name",
        "apartment__unit_code",
        "apartment__owner_name",
    )
    autocomplete_fields = ("user", "apartment")
    ordering = ("apartment__unit_code", "user__username")

    @admin.display(description="Role")
    def membership_role(self, obj: ApartmentUser) -> str:
        if obj.is_owner and obj.is_tenant:
            return "Owner & tenant"
        if obj.is_owner:
            return "Owner"
        if obj.is_tenant:
            return "Tenant"
        return "—"


admin.site.register(DesignatedVoter)
admin.site.register(HeatingMeasurementInput)
admin.site.register(HeatedWaterMeasurementInput)
admin.site.register(BuildingMeasurementInput)
admin.site.register(ExpenseItem)
admin.site.register(Invoice)
