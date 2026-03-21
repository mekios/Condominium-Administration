from decimal import Decimal, ROUND_HALF_UP
from datetime import date

from django.core import mail
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import User
from flats.models import (
    Apartment,
    Building,
    ExpenseItem,
    HeatedWaterMeasurementInput,
    HeatingMeasurementInput,
    Invoice,
    InvoiceDocument,
    NotificationDispatch,
    PaymentRecord,
)


def q2(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


class InvoiceGenerationTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin_test",
            password="pass1234",
            role=User.Role.ADMINISTRATOR,
        )
        self.client.force_authenticate(user=self.admin)

        self.building = Building.objects.create(name="B1")
        self.a1 = Apartment.objects.create(
            building=self.building,
            unit_code="A1",
            ownership_permille=Decimal("500"),
            heating_e_factor=Decimal("0.10"),
            heating_f_factor=Decimal("0.30"),
        )
        self.a2 = Apartment.objects.create(
            building=self.building,
            unit_code="A2",
            ownership_permille=Decimal("500"),
            heating_e_factor=Decimal("0.20"),
            heating_f_factor=Decimal("0.20"),
        )

    def test_invoice_generation_uses_formula_for_radiator_only_gas(self):
        month = "2026-04"
        HeatingMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=date(2026, 4, 1),
            billing_period_start=date(2026, 3, 1),
            billing_period_end=date(2026, 4, 1),
            e_factor=Decimal("0.10"),
            f_factor=Decimal("0.30"),
            units_counted=Decimal("100"),
            computed_radiator_heating_energy=Decimal("0.03"),
            created_by_user=self.admin,
        )
        HeatingMeasurementInput.objects.create(
            apartment=self.a2,
            measurement_date=date(2026, 4, 1),
            billing_period_start=date(2026, 3, 1),
            billing_period_end=date(2026, 4, 1),
            e_factor=Decimal("0.20"),
            f_factor=Decimal("0.20"),
            units_counted=Decimal("80"),
            computed_radiator_heating_energy=Decimal("0.04"),
            created_by_user=self.admin,
        )
        HeatedWaterMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=date(2026, 4, 1),
            billing_period_start=date(2026, 3, 1),
            billing_period_end=date(2026, 4, 1),
            computed_heating_water_volume=Decimal("30"),
            created_by_user=self.admin,
        )
        HeatedWaterMeasurementInput.objects.create(
            apartment=self.a2,
            measurement_date=date(2026, 4, 1),
            billing_period_start=date(2026, 3, 1),
            billing_period_end=date(2026, 4, 1),
            computed_heating_water_volume=Decimal("70"),
            created_by_user=self.admin,
        )

        ExpenseItem.objects.create(
            building=self.building,
            expense_category=ExpenseItem.Category.GAS_HEATING,
            expense_date=date(2026, 4, 10),
            amount=Decimal("200.00"),
            description="gas",
            created_by_user=self.admin,
        )
        ExpenseItem.objects.create(
            building=self.building,
            expense_category=ExpenseItem.Category.WATER_HW_CONSUMPTION,
            expense_date=date(2026, 4, 10),
            amount=Decimal("100.00"),
            description="water",
            created_by_user=self.admin,
        )

        response = self.client.post(reverse("invoices-generate"), {"month": month}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        i1 = Invoice.objects.get(apartment=self.a1, month=month)
        i2 = Invoice.objects.get(apartment=self.a2, month=month)

        # Formula shares:
        # a1 = 0.03 + (100/180)*(1-0.07) = 0.546666...
        # a2 = 0.04 + (80/180)*(1-0.07) = 0.453333...
        s1 = Decimal("0.5466666666666666666666666667")
        s2 = Decimal("0.4533333333333333333333333333")
        gas_total = Decimal("200")
        water_bill = Decimal("100")
        expected_i1_radiators = q2(gas_total * s1)
        expected_i2_radiators = q2(gas_total * s2)
        expected_i1_heated_water = Decimal("0.00")
        expected_i2_heated_water = Decimal("0.00")
        expected_i1_water = q2(water_bill * Decimal("0.30"))
        expected_i2_water = q2(water_bill * Decimal("0.70"))

        self.assertEqual(i1.heating_radiators_total, expected_i1_radiators)
        self.assertEqual(i2.heating_radiators_total, expected_i2_radiators)
        self.assertEqual(i1.heated_water_energy_total, expected_i1_heated_water)
        self.assertEqual(i2.heated_water_energy_total, expected_i2_heated_water)
        self.assertEqual(i1.water_consumption_total, expected_i1_water)
        self.assertEqual(i2.water_consumption_total, expected_i2_water)

        self.assertEqual(
            i1.invoice_total,
            q2(expected_i1_radiators + expected_i1_heated_water + expected_i1_water),
        )
        self.assertEqual(
            i2.invoice_total,
            q2(expected_i2_radiators + expected_i2_heated_water + expected_i2_water),
        )

    def test_invoice_generate_rejects_invalid_sum_fixed(self):
        month = "2026-05"
        HeatingMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=date(2026, 5, 1),
            billing_period_start=date(2026, 4, 1),
            billing_period_end=date(2026, 5, 1),
            e_factor=Decimal("2.0"),
            f_factor=Decimal("1.0"),
            units_counted=Decimal("10"),
            computed_radiator_heating_energy=Decimal("2.0"),
            created_by_user=self.admin,
        )
        ExpenseItem.objects.create(
            building=self.building,
            expense_category=ExpenseItem.Category.GAS_HEATING,
            expense_date=date(2026, 5, 10),
            amount=Decimal("100.00"),
            created_by_user=self.admin,
        )

        response = self.client.post(reverse("invoices-generate"), {"month": month}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("άθροισμα(fi*ei)", response.data["detail"])

    def test_heating_bulk_upsert_uses_apartment_factors(self):
        response = self.client.post(
            reverse("heating-inputs-bulk-upsert"),
            {
                "measurement_date": "2026-06-01",
                "billing_period_start": "2026-05-01",
                "billing_period_end": "2026-06-01",
                "rows": [
                    {"apartment_id": self.a1.id, "units_counted": "12"},
                    {"apartment_id": self.a2.id, "units_counted": "18"},
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        h1 = HeatingMeasurementInput.objects.get(apartment=self.a1, measurement_date=date(2026, 6, 1))
        h2 = HeatingMeasurementInput.objects.get(apartment=self.a2, measurement_date=date(2026, 6, 1))
        self.assertEqual(h1.e_factor, Decimal("0.1000"))
        self.assertEqual(h1.f_factor, Decimal("0.3000"))
        self.assertEqual(h2.e_factor, Decimal("0.2000"))
        self.assertEqual(h2.f_factor, Decimal("0.2000"))

    def test_admin_can_update_apartment_heating_factors(self):
        response = self.client.patch(
            reverse("apartments-heating-factors", args=[self.a1.id]),
            {"heating_e_factor": "0.1550", "heating_f_factor": "0.2550"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.a1.refresh_from_db()
        self.assertEqual(self.a1.heating_e_factor, Decimal("0.1550"))
        self.assertEqual(self.a1.heating_f_factor, Decimal("0.2550"))

    def test_monthly_upsert_computes_units_from_previous_readings(self):
        HeatingMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=date(2026, 6, 1),
            billing_period_start=date(2026, 5, 1),
            billing_period_end=date(2026, 6, 1),
            e_factor=Decimal("0.10"),
            f_factor=Decimal("0.30"),
            current_reading=Decimal("150"),
            units_counted=Decimal("10"),
            computed_radiator_heating_energy=Decimal("0.03"),
            created_by_user=self.admin,
        )
        HeatedWaterMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=date(2026, 6, 1),
            billing_period_start=date(2026, 5, 1),
            billing_period_end=date(2026, 6, 1),
            current_reading=Decimal("40"),
            computed_heating_water_volume=Decimal("5"),
            created_by_user=self.admin,
        )

        response = self.client.post(
            reverse("heating-inputs-monthly-upsert"),
            {
                "measurement_date": "2026-07-01",
                "billing_period_start": "2026-06-01",
                "billing_period_end": "2026-07-01",
                "rows": [
                    {
                        "apartment_id": self.a1.id,
                        "heating_current_reading": "170",
                        "heated_water_current_reading": "47",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        h = HeatingMeasurementInput.objects.get(apartment=self.a1, measurement_date=date(2026, 7, 1))
        w = HeatedWaterMeasurementInput.objects.get(apartment=self.a1, measurement_date=date(2026, 7, 1))
        self.assertEqual(h.current_reading, Decimal("170.0000"))
        self.assertEqual(h.units_counted, Decimal("20.0000"))
        self.assertEqual(w.current_reading, Decimal("47.0000"))
        self.assertEqual(w.computed_heating_water_volume, Decimal("7.0000"))

    def test_dates_endpoint_returns_suggested_next_date(self):
        HeatingMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=date(2026, 7, 1),
            billing_period_start=date(2026, 6, 1),
            billing_period_end=date(2026, 7, 1),
            e_factor=Decimal("0.10"),
            f_factor=Decimal("0.30"),
            current_reading=Decimal("170"),
            units_counted=Decimal("20"),
            computed_radiator_heating_energy=Decimal("0.03"),
            created_by_user=self.admin,
        )
        response = self.client.get(reverse("heating-inputs-dates"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(str(response.data["suggested_next_date"]), "2026-08-01")

    def test_expense_api_requires_measurement_range_for_gas_and_water(self):
        response = self.client.post(
            reverse("expenses-list"),
            {
                "building": self.building.id,
                "expense_category": ExpenseItem.Category.GAS_HEATING,
                "expense_date": "2026-07-10",
                "amount": "120.00",
                "description": "gas without range",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("εύρος ημερομηνιών", str(response.data))

    def test_generate_uses_affected_measurement_period(self):
        month = "2026-05"
        HeatingMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=date(2026, 3, 1),
            billing_period_start=date(2026, 2, 1),
            billing_period_end=date(2026, 3, 1),
            e_factor=Decimal("0.10"),
            f_factor=Decimal("0.30"),
            current_reading=Decimal("100"),
            units_counted=Decimal("0"),
            computed_radiator_heating_energy=Decimal("0.03"),
            created_by_user=self.admin,
        )
        HeatingMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=date(2026, 4, 1),
            billing_period_start=date(2026, 3, 1),
            billing_period_end=date(2026, 4, 1),
            e_factor=Decimal("0.10"),
            f_factor=Decimal("0.30"),
            current_reading=Decimal("130"),
            units_counted=Decimal("30"),
            computed_radiator_heating_energy=Decimal("0.03"),
            created_by_user=self.admin,
        )
        HeatingMeasurementInput.objects.create(
            apartment=self.a2,
            measurement_date=date(2026, 3, 1),
            billing_period_start=date(2026, 2, 1),
            billing_period_end=date(2026, 3, 1),
            e_factor=Decimal("0.20"),
            f_factor=Decimal("0.20"),
            current_reading=Decimal("150"),
            units_counted=Decimal("0"),
            computed_radiator_heating_energy=Decimal("0.04"),
            created_by_user=self.admin,
        )
        HeatingMeasurementInput.objects.create(
            apartment=self.a2,
            measurement_date=date(2026, 4, 1),
            billing_period_start=date(2026, 3, 1),
            billing_period_end=date(2026, 4, 1),
            e_factor=Decimal("0.20"),
            f_factor=Decimal("0.20"),
            current_reading=Decimal("170"),
            units_counted=Decimal("20"),
            computed_radiator_heating_energy=Decimal("0.04"),
            created_by_user=self.admin,
        )
        HeatedWaterMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=date(2026, 3, 1),
            billing_period_start=date(2026, 2, 1),
            billing_period_end=date(2026, 3, 1),
            current_reading=Decimal("10"),
            computed_heating_water_volume=Decimal("0"),
            created_by_user=self.admin,
        )
        HeatedWaterMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=date(2026, 4, 1),
            billing_period_start=date(2026, 3, 1),
            billing_period_end=date(2026, 4, 1),
            current_reading=Decimal("18"),
            computed_heating_water_volume=Decimal("8"),
            created_by_user=self.admin,
        )
        HeatedWaterMeasurementInput.objects.create(
            apartment=self.a2,
            measurement_date=date(2026, 3, 1),
            billing_period_start=date(2026, 2, 1),
            billing_period_end=date(2026, 3, 1),
            current_reading=Decimal("20"),
            computed_heating_water_volume=Decimal("0"),
            created_by_user=self.admin,
        )
        HeatedWaterMeasurementInput.objects.create(
            apartment=self.a2,
            measurement_date=date(2026, 4, 1),
            billing_period_start=date(2026, 3, 1),
            billing_period_end=date(2026, 4, 1),
            current_reading=Decimal("32"),
            computed_heating_water_volume=Decimal("12"),
            created_by_user=self.admin,
        )
        ExpenseItem.objects.create(
            building=self.building,
            expense_category=ExpenseItem.Category.GAS_HEATING,
            expense_date=date(2026, 5, 10),
            amount=Decimal("150.00"),
            affected_period_start=date(2026, 3, 1),
            affected_period_end=date(2026, 4, 1),
            created_by_user=self.admin,
        )
        response = self.client.post(reverse("invoices-generate"), {"month": month}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        i1 = Invoice.objects.get(apartment=self.a1, month=month)
        i2 = Invoice.objects.get(apartment=self.a2, month=month)
        self.assertGreater(i1.heating_radiators_total + i1.heated_water_energy_total, Decimal("0"))
        self.assertGreater(i2.heating_radiators_total + i2.heated_water_energy_total, Decimal("0"))

    def test_water_types_allocation_rules(self):
        month = "2026-04"
        HeatingMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=date(2026, 4, 1),
            billing_period_start=date(2026, 3, 1),
            billing_period_end=date(2026, 4, 1),
            e_factor=Decimal("0.10"),
            f_factor=Decimal("0.30"),
            units_counted=Decimal("100"),
            computed_radiator_heating_energy=Decimal("0.03"),
            created_by_user=self.admin,
        )
        HeatingMeasurementInput.objects.create(
            apartment=self.a2,
            measurement_date=date(2026, 4, 1),
            billing_period_start=date(2026, 3, 1),
            billing_period_end=date(2026, 4, 1),
            e_factor=Decimal("0.20"),
            f_factor=Decimal("0.20"),
            units_counted=Decimal("80"),
            computed_radiator_heating_energy=Decimal("0.04"),
            created_by_user=self.admin,
        )
        HeatedWaterMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=date(2026, 4, 1),
            billing_period_start=date(2026, 3, 1),
            billing_period_end=date(2026, 4, 1),
            computed_heating_water_volume=Decimal("30"),
            created_by_user=self.admin,
        )
        HeatedWaterMeasurementInput.objects.create(
            apartment=self.a2,
            measurement_date=date(2026, 4, 1),
            billing_period_start=date(2026, 3, 1),
            billing_period_end=date(2026, 4, 1),
            computed_heating_water_volume=Decimal("70"),
            created_by_user=self.admin,
        )

        # Heater water: must be distributed by measured hot-water volume (30/70).
        ExpenseItem.objects.create(
            building=self.building,
            expense_category=ExpenseItem.Category.WATER_HW_CONSUMPTION,
            expense_date=date(2026, 4, 10),
            amount=Decimal("100.00"),
            created_by_user=self.admin,
        )
        # Garden water: must be distributed by ownership permille (50/50 here).
        ExpenseItem.objects.create(
            building=self.building,
            expense_category=ExpenseItem.Category.COMMON_WATER,
            expense_date=date(2026, 4, 10),
            amount=Decimal("100.00"),
            created_by_user=self.admin,
        )

        response = self.client.post(reverse("invoices-generate"), {"month": month}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        i1 = Invoice.objects.get(apartment=self.a1, month=month)
        i2 = Invoice.objects.get(apartment=self.a2, month=month)

        # Heater-water bill split by volume.
        self.assertEqual(i1.water_consumption_total, Decimal("30.00"))
        self.assertEqual(i2.water_consumption_total, Decimal("70.00"))
        # Garden-water bill split by ownership permille.
        self.assertEqual(i1.common_recurring_total, Decimal("50.00"))
        self.assertEqual(i2.common_recurring_total, Decimal("50.00"))

    def test_owners_only_allocation_by_permille(self):
        month = "2026-05"
        ExpenseItem.objects.create(
            building=self.building,
            expense_category=ExpenseItem.Category.OWNERS_ONLY,
            expense_date=date(2026, 5, 10),
            amount=Decimal("200.00"),
            description="Ανάγλυφο προσόψεως",
            created_by_user=self.admin,
        )

        response = self.client.post(reverse("invoices-generate"), {"month": month}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        i1 = Invoice.objects.get(apartment=self.a1, month=month)
        i2 = Invoice.objects.get(apartment=self.a2, month=month)

        # Owners-only: split by ownership permille (50/50 here).
        self.assertEqual(i1.owners_only_total, Decimal("100.00"))
        self.assertEqual(i2.owners_only_total, Decimal("100.00"))

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_mark_paid_creates_payment_receipt_and_email_dispatch(self):
        month = "2026-05"
        invoice = Invoice.objects.create(
            apartment=self.a1,
            month=month,
            invoice_total=Decimal("120.00"),
            paid_total=Decimal("0.00"),
            outstanding_balance=Decimal("120.00"),
            status=Invoice.Status.ISSUED,
        )
        self.admin.email = "admin@example.com"
        self.admin.save(update_fields=["email"])
        self.a1.memberships.create(user=self.admin, is_owner=True, is_tenant=False)

        response = self.client.post(
            reverse("invoices-mark-paid", args=[invoice.id]),
            {"amount": "120.00", "payment_date": "2026-05-20", "method": "bank_transfer", "reference": "TX123"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        invoice.refresh_from_db()
        self.assertEqual(invoice.status, Invoice.Status.PAID)
        self.assertEqual(invoice.paid_total, Decimal("120.00"))
        self.assertEqual(invoice.outstanding_balance, Decimal("0.00"))

        payment = PaymentRecord.objects.get(invoice=invoice)
        self.assertEqual(payment.amount, Decimal("120.00"))

        receipt = InvoiceDocument.objects.get(invoice=invoice, payment=payment, document_type=InvoiceDocument.DocumentType.RECEIPT)
        self.assertTrue(receipt.file_name.endswith(".pdf"))
        self.assertEqual(receipt.mime_type, "application/pdf")
        self.assertTrue(bytes(receipt.content).startswith(b"%PDF-1.4"))

        dispatch = NotificationDispatch.objects.get(invoice=invoice, payment=payment)
        self.assertEqual(dispatch.status, NotificationDispatch.Status.SENT)
        self.assertEqual(len(mail.outbox), 1)

    def test_send_receipt_blocks_duplicate_without_force(self):
        month = "2026-06"
        invoice = Invoice.objects.create(
            apartment=self.a1,
            month=month,
            invoice_total=Decimal("50.00"),
            paid_total=Decimal("50.00"),
            outstanding_balance=Decimal("0.00"),
            status=Invoice.Status.PAID,
        )
        payment = PaymentRecord.objects.create(
            invoice=invoice,
            apartment=self.a1,
            amount=Decimal("50.00"),
            payment_date=date(2026, 6, 20),
            method=PaymentRecord.Method.CASH,
            created_by_user=self.admin,
        )
        NotificationDispatch.objects.create(
            invoice=invoice,
            payment=payment,
            notification_type=NotificationDispatch.NotificationType.RECEIPT_PAID,
            recipient_email="a@example.com",
            status=NotificationDispatch.Status.SENT,
        )
        response = self.client.post(reverse("invoices-send-receipt", args=[invoice.id]), {"payment_id": payment.id}, format="json")
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
