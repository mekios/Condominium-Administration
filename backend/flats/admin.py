from django.contrib import admin

from .models import (
    Apartment,
    ApartmentUser,
    Building,
    DesignatedVoter,
    ExpenseItem,
    HeatingMeasurementInput,
    HeatedWaterMeasurementInput,
    Invoice,
)

admin.site.register(Building)
admin.site.register(Apartment)
admin.site.register(ApartmentUser)
admin.site.register(DesignatedVoter)
admin.site.register(HeatingMeasurementInput)
admin.site.register(HeatedWaterMeasurementInput)
admin.site.register(ExpenseItem)
admin.site.register(Invoice)
