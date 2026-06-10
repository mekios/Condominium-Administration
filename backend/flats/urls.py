from rest_framework.routers import DefaultRouter

from .views import (
    ApartmentViewSet,
    ExpenseItemViewSet,
    HeatingMeasurementInputViewSet,
    HeatedWaterMeasurementInputViewSet,
    InvoiceViewSet,
    PaymentRecordViewSet,
    VoteSessionViewSet,
)

router = DefaultRouter()
router.register("apartments", ApartmentViewSet, basename="apartments")
router.register("accounting/heating-inputs", HeatingMeasurementInputViewSet, basename="heating-inputs")
router.register("accounting/heated-water-inputs", HeatedWaterMeasurementInputViewSet, basename="heated-water-inputs")
router.register("accounting/expenses", ExpenseItemViewSet, basename="expenses")
router.register("accounting/payments", PaymentRecordViewSet, basename="payments")
router.register("invoices", InvoiceViewSet, basename="invoices")
router.register("voting/sessions", VoteSessionViewSet, basename="voting-sessions")

urlpatterns = router.urls
