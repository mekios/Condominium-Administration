from decimal import Decimal, ROUND_HALF_UP
from datetime import date, timedelta

from django.core import mail
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import User
from flats.models import (
    Apartment,
    ApartmentUser,
    Building,
    BuildingMeasurementInput,
    DesignatedVoter,
    ExpenseItem,
    HeatedWaterMeasurementInput,
    HeatingMeasurementInput,
    Invoice,
    InvoiceDocument,
    NotificationDispatch,
    PaymentRecord,
    Vote,
    VoteSession,
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
            e_factor=Decimal("0.10"),
            f_factor=Decimal("0.30"),
            units_counted=Decimal("100"),
            computed_radiator_heating_energy=Decimal("0.03"),
            created_by_user=self.admin,
        )
        HeatingMeasurementInput.objects.create(
            apartment=self.a2,
            measurement_date=date(2026, 4, 1),
            e_factor=Decimal("0.20"),
            f_factor=Decimal("0.20"),
            units_counted=Decimal("80"),
            computed_radiator_heating_energy=Decimal("0.04"),
            created_by_user=self.admin,
        )
        HeatedWaterMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=date(2026, 4, 1),
            computed_heating_water_volume=Decimal("30"),
            created_by_user=self.admin,
        )
        HeatedWaterMeasurementInput.objects.create(
            apartment=self.a2,
            measurement_date=date(2026, 4, 1),
            computed_heating_water_volume=Decimal("70"),
            created_by_user=self.admin,
        )
        BuildingMeasurementInput.objects.create(
            building=self.building,
            measurement_date=date(2026, 4, 1),
            hot_water_heating_current_reading=Decimal("30"),
            hot_water_heating_units=Decimal("30"),
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
        sum_heating = Decimal("180")
        building_hw = Decimal("30")
        total_energy = sum_heating + building_hw
        gas_radiator = gas_total * sum_heating / total_energy
        gas_hw = gas_total * building_hw / total_energy
        from flats.views import _allocate_amount_by_weights

        radiator_allocations = _allocate_amount_by_weights(
            gas_radiator,
            {self.a1.id: s1, self.a2.id: s2},
        )
        hw_allocations = _allocate_amount_by_weights(
            gas_hw,
            {self.a1.id: Decimal("0.30"), self.a2.id: Decimal("0.70")},
        )
        expected_i1_radiators = radiator_allocations[self.a1.id]
        expected_i2_radiators = radiator_allocations[self.a2.id]
        expected_i1_heated_water = hw_allocations[self.a1.id]
        expected_i2_heated_water = hw_allocations[self.a2.id]
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

    def test_building_measurement_upsert_computes_delta(self):
        BuildingMeasurementInput.objects.create(
            building=self.building,
            measurement_date=date(2026, 6, 1),
            hot_water_heating_current_reading=Decimal("100"),
            hot_water_heating_units=Decimal("100"),
            created_by_user=self.admin,
        )
        HeatingMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=date(2026, 6, 1),
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
            current_reading=Decimal("40"),
            computed_heating_water_volume=Decimal("5"),
            created_by_user=self.admin,
        )

        response = self.client.post(
            reverse("heating-inputs-monthly-upsert"),
            {
                "measurement_date": "2026-07-01",
                "building_hot_water_heating_reading": "130",
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
        building = BuildingMeasurementInput.objects.get(building=self.building, measurement_date=date(2026, 7, 1))
        self.assertEqual(building.hot_water_heating_current_reading, Decimal("130.0"))
        self.assertEqual(building.hot_water_heating_units, Decimal("30.0"))

    def test_invoice_generation_blocks_zero_total_energy(self):
        month = "2026-04"
        ExpenseItem.objects.create(
            building=self.building,
            expense_category=ExpenseItem.Category.GAS_HEATING,
            expense_date=date(2026, 4, 10),
            amount=Decimal("200.00"),
            affected_period_start=date(2026, 4, 1),
            affected_period_end=date(2026, 4, 30),
            created_by_user=self.admin,
        )
        response = self.client.post(reverse("invoices-generate"), {"month": month}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Μηδενική συνολική κατανάλωση", str(response.data))

    def test_invoice_generation_blocks_dual_gas_categories(self):
        month = "2026-04"
        self._seed_april_measurements_with_building()
        ExpenseItem.objects.create(
            building=self.building,
            expense_category=ExpenseItem.Category.GAS_HEATING,
            expense_date=date(2026, 4, 10),
            amount=Decimal("200.00"),
            created_by_user=self.admin,
        )
        ExpenseItem.objects.create(
            building=self.building,
            expense_category=ExpenseItem.Category.GAS_HW_CONSUMPTION,
            expense_date=date(2026, 4, 10),
            amount=Decimal("50.00"),
            created_by_user=self.admin,
        )
        response = self.client.post(reverse("invoices-generate"), {"month": month}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("παλαιά κατηγορία", str(response.data))

    def test_rejects_new_gas_hw_expense(self):
        response = self.client.post(
            reverse("expenses-list"),
            {
                "building": self.building.id,
                "expense_category": ExpenseItem.Category.GAS_HW_CONSUMPTION,
                "expense_date": "2026-07-10",
                "amount": "50.00",
                "description": "legacy gas hw",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("δεν υποστηρίζεται πλέον", str(response.data))

    def _seed_april_measurements_with_building(self):
        HeatingMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=date(2026, 4, 1),
            e_factor=Decimal("0.10"),
            f_factor=Decimal("0.30"),
            units_counted=Decimal("100"),
            computed_radiator_heating_energy=Decimal("0.03"),
            created_by_user=self.admin,
        )
        HeatingMeasurementInput.objects.create(
            apartment=self.a2,
            measurement_date=date(2026, 4, 1),
            e_factor=Decimal("0.20"),
            f_factor=Decimal("0.20"),
            units_counted=Decimal("80"),
            computed_radiator_heating_energy=Decimal("0.04"),
            created_by_user=self.admin,
        )
        HeatedWaterMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=date(2026, 4, 1),
            computed_heating_water_volume=Decimal("30"),
            created_by_user=self.admin,
        )
        HeatedWaterMeasurementInput.objects.create(
            apartment=self.a2,
            measurement_date=date(2026, 4, 1),
            computed_heating_water_volume=Decimal("70"),
            created_by_user=self.admin,
        )
        BuildingMeasurementInput.objects.create(
            building=self.building,
            measurement_date=date(2026, 4, 1),
            hot_water_heating_current_reading=Decimal("30"),
            hot_water_heating_units=Decimal("30"),
            created_by_user=self.admin,
        )

    def test_invoice_generation_applies_custom_adjustments(self):
        month = "2026-04"
        HeatingMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=date(2026, 4, 1),
            e_factor=Decimal("0.10"),
            f_factor=Decimal("0.30"),
            units_counted=Decimal("100"),
            computed_radiator_heating_energy=Decimal("0.03"),
            created_by_user=self.admin,
        )
        HeatingMeasurementInput.objects.create(
            apartment=self.a2,
            measurement_date=date(2026, 4, 1),
            e_factor=Decimal("0.20"),
            f_factor=Decimal("0.20"),
            units_counted=Decimal("80"),
            computed_radiator_heating_energy=Decimal("0.04"),
            created_by_user=self.admin,
        )
        ExpenseItem.objects.create(
            building=self.building,
            expense_category=ExpenseItem.Category.GAS_HEATING,
            expense_date=date(2026, 4, 10),
            amount=Decimal("200.00"),
            created_by_user=self.admin,
        )

        response = self.client.post(
            reverse("invoices-generate"),
            {
                "month": month,
                "adjustments": [
                    {"apartment": self.a1.id, "amount": "-25.50", "note": "Έργα ιδιοκτήτη"},
                    {"apartment": self.a2.id, "amount": "10.00", "note": "Αγορά υλικών"},
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        i1 = Invoice.objects.get(apartment=self.a1, month=month)
        i2 = Invoice.objects.get(apartment=self.a2, month=month)
        base_i1 = q2(Decimal("200.00") * Decimal("0.5466666666666666666666666667"))
        base_i2 = q2(Decimal("200.00") * Decimal("0.4533333333333333333333333333"))

        self.assertEqual(i1.custom_adjustment, q2(Decimal("-25.50")))
        self.assertEqual(i1.custom_adjustment_note, "Έργα ιδιοκτήτη")
        self.assertEqual(i1.invoice_total, q2(base_i1 + Decimal("-25.50")))
        self.assertEqual(i2.custom_adjustment, q2(Decimal("10.00")))
        self.assertEqual(i2.custom_adjustment_note, "Αγορά υλικών")
        self.assertEqual(i2.invoice_total, q2(base_i2 + Decimal("10.00")))

        from flats.views import _create_invoice_pdf

        _, pdf_bytes = _create_invoice_pdf(i1)
        self.assertTrue(pdf_bytes.startswith(b"%PDF"))
        self.assertGreater(len(pdf_bytes), 5000)

        preview = self.client.get(reverse("invoices-preview"), {"month": month})
        self.assertEqual(preview.status_code, status.HTTP_200_OK)
        preview_by_apartment = {item["apartment"]: item for item in preview.data["items"]}
        self.assertEqual(Decimal(preview_by_apartment[self.a1.id]["custom_adjustment"]), i1.custom_adjustment)
        self.assertEqual(preview_by_apartment[self.a1.id]["custom_adjustment_note"], "Έργα ιδιοκτήτη")

    def test_invoice_generate_rejects_invalid_sum_fixed(self):
        month = "2026-05"
        HeatingMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=date(2026, 5, 1),
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
            current_reading=Decimal("40"),
            computed_heating_water_volume=Decimal("5"),
            created_by_user=self.admin,
        )

        response = self.client.post(
            reverse("heating-inputs-monthly-upsert"),
            {
                "measurement_date": "2026-07-01",
                "building_hot_water_heating_reading": "110",
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
            current_reading=Decimal("10"),
            computed_heating_water_volume=Decimal("0"),
            created_by_user=self.admin,
        )
        HeatedWaterMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=date(2026, 4, 1),
            current_reading=Decimal("18"),
            computed_heating_water_volume=Decimal("8"),
            created_by_user=self.admin,
        )
        HeatedWaterMeasurementInput.objects.create(
            apartment=self.a2,
            measurement_date=date(2026, 3, 1),
            current_reading=Decimal("20"),
            computed_heating_water_volume=Decimal("0"),
            created_by_user=self.admin,
        )
        HeatedWaterMeasurementInput.objects.create(
            apartment=self.a2,
            measurement_date=date(2026, 4, 1),
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
            e_factor=Decimal("0.10"),
            f_factor=Decimal("0.30"),
            units_counted=Decimal("100"),
            computed_radiator_heating_energy=Decimal("0.03"),
            created_by_user=self.admin,
        )
        HeatingMeasurementInput.objects.create(
            apartment=self.a2,
            measurement_date=date(2026, 4, 1),
            e_factor=Decimal("0.20"),
            f_factor=Decimal("0.20"),
            units_counted=Decimal("80"),
            computed_radiator_heating_energy=Decimal("0.04"),
            created_by_user=self.admin,
        )
        HeatedWaterMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=date(2026, 4, 1),
            computed_heating_water_volume=Decimal("30"),
            created_by_user=self.admin,
        )
        HeatedWaterMeasurementInput.objects.create(
            apartment=self.a2,
            measurement_date=date(2026, 4, 1),
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

    def test_invoice_pdf_includes_expense_breakdown(self):
        from flats.views import _build_grouped_invoice_pdf_rows, _calculate_invoice_rows, _create_invoice_pdf

        month = "2026-06"
        ExpenseItem.objects.create(
            building=self.building,
            expense_category=ExpenseItem.Category.CLEANING,
            expense_date=date(2026, 6, 5),
            amount=Decimal("60.00"),
            created_by_user=self.admin,
        )
        ExpenseItem.objects.create(
            building=self.building,
            expense_category=ExpenseItem.Category.OTHER,
            expense_date=date(2026, 6, 12),
            amount=Decimal("40.00"),
            description="Αντικατάσταση λάμπας",
            created_by_user=self.admin,
        )

        self.client.post(reverse("invoices-generate"), {"month": month}, format="json")
        invoice = Invoice.objects.get(apartment=self.a1, month=month)

        result, error = _calculate_invoice_rows(month)
        self.assertIsNone(error)
        _, _, breakdown = result
        self.assertEqual(len(breakdown[self.a1.id]), 2)
        bucket_keys = {line["bucket_key"] for line in breakdown[self.a1.id]}
        self.assertEqual(bucket_keys, {"common_recurring_total", "common_non_recurring_total"})
        share_total = sum((line["share"] for line in breakdown[self.a1.id]), Decimal("0.00"))
        self.assertEqual(share_total, invoice.invoice_total)

        grouped_rows, emphasis_rows = _build_grouped_invoice_pdf_rows(breakdown[self.a1.id])
        self.assertEqual(grouped_rows[0][0], "Κοινόχρηστα")
        self.assertEqual(grouped_rows[2][0], "Έκτακτα")
        self.assertEqual(grouped_rows[-1][0], "Σύνολο")
        self.assertIn(0, emphasis_rows)
        self.assertIn(len(grouped_rows) - 1, emphasis_rows)

        _, pdf_bytes = _create_invoice_pdf(invoice)
        self.assertTrue(pdf_bytes.startswith(b"%PDF"))
        self.assertGreater(len(pdf_bytes), 5000)

    def test_generate_response_includes_summary_and_warnings(self):
        month = "2026-09"
        HeatingMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=date(2026, 9, 1),
            e_factor=Decimal("0.10"),
            f_factor=Decimal("0.30"),
            units_counted=Decimal("50"),
            computed_radiator_heating_energy=Decimal("0.03"),
            created_by_user=self.admin,
        )
        HeatingMeasurementInput.objects.create(
            apartment=self.a2,
            measurement_date=date(2026, 9, 1),
            e_factor=Decimal("0.20"),
            f_factor=Decimal("0.20"),
            units_counted=Decimal("50"),
            computed_radiator_heating_energy=Decimal("0.04"),
            created_by_user=self.admin,
        )
        ExpenseItem.objects.create(
            building=self.building,
            expense_category=ExpenseItem.Category.GAS_HEATING,
            expense_date=date(2026, 9, 10),
            amount=Decimal("120.00"),
            created_by_user=self.admin,
        )

        response = self.client.post(reverse("invoices-generate"), {"month": month}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["month"], month)
        self.assertIn("created", response.data)
        self.assertIn("updated", response.data)
        self.assertIn("warnings", response.data)
        self.assertGreater(len(response.data["warnings"]), 0)

    def test_invoice_generation_isolated_per_building_and_month(self):
        month = "2026-10"
        other_building = Building.objects.create(name="B2")
        b2a1 = Apartment.objects.create(
            building=other_building,
            unit_code="B2A1",
            ownership_permille=Decimal("1000"),
            heating_e_factor=Decimal("0.10"),
            heating_f_factor=Decimal("0.20"),
        )

        ExpenseItem.objects.create(
            building=self.building,
            expense_category=ExpenseItem.Category.COMMON_POWER,
            expense_date=date(2026, 10, 12),
            amount=Decimal("60.00"),
            created_by_user=self.admin,
        )
        ExpenseItem.objects.create(
            building=other_building,
            expense_category=ExpenseItem.Category.COMMON_POWER,
            expense_date=date(2026, 10, 12),
            amount=Decimal("90.00"),
            created_by_user=self.admin,
        )
        ExpenseItem.objects.create(
            building=self.building,
            expense_category=ExpenseItem.Category.COMMON_POWER,
            expense_date=date(2026, 11, 12),
            amount=Decimal("999.00"),
            created_by_user=self.admin,
        )

        response = self.client.post(reverse("invoices-generate"), {"month": month}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        i1 = Invoice.objects.get(apartment=self.a1, month=month)
        i2 = Invoice.objects.get(apartment=self.a2, month=month)
        i3 = Invoice.objects.get(apartment=b2a1, month=month)

        self.assertEqual(i1.common_recurring_total, Decimal("30.00"))
        self.assertEqual(i2.common_recurring_total, Decimal("30.00"))
        self.assertEqual(i3.common_recurring_total, Decimal("90.00"))
        self.assertEqual(i1.invoice_total + i2.invoice_total + i3.invoice_total, Decimal("150.00"))

    def test_rounding_remainder_distribution_keeps_category_total_balanced(self):
        month = "2026-12"
        a3 = Apartment.objects.create(
            building=self.building,
            unit_code="A3",
            ownership_permille=Decimal("0"),
            heating_e_factor=Decimal("0.10"),
            heating_f_factor=Decimal("0.20"),
        )
        self.a1.ownership_permille = Decimal("333")
        self.a2.ownership_permille = Decimal("333")
        a3.ownership_permille = Decimal("334")
        self.a1.save(update_fields=["ownership_permille"])
        self.a2.save(update_fields=["ownership_permille"])
        a3.save(update_fields=["ownership_permille"])

        ExpenseItem.objects.create(
            building=self.building,
            expense_category=ExpenseItem.Category.COMMON_POWER,
            expense_date=date(2026, 12, 5),
            amount=Decimal("100.00"),
            created_by_user=self.admin,
        )

        response = self.client.post(reverse("invoices-generate"), {"month": month}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        invoices = Invoice.objects.filter(apartment__in=[self.a1, self.a2, a3], month=month)
        allocated_total = sum((inv.common_recurring_total for inv in invoices), Decimal("0.00"))
        self.assertEqual(allocated_total, Decimal("100.00"))

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

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_send_monthly_invoices_dispatches_and_skips_duplicates(self):
        month = "2026-07"
        tenant_1 = User.objects.create_user(username="tenant_a1", password="pass1234", email="a1@example.com")
        tenant_2 = User.objects.create_user(username="tenant_a2", password="pass1234", email="a2@example.com")
        self.a1.memberships.create(user=tenant_1, is_owner=True, is_tenant=False)
        self.a2.memberships.create(user=tenant_2, is_owner=True, is_tenant=False)

        Invoice.objects.create(
            apartment=self.a1,
            month=month,
            invoice_total=Decimal("111.00"),
            paid_total=Decimal("0.00"),
            outstanding_balance=Decimal("111.00"),
            status=Invoice.Status.ISSUED,
        )
        Invoice.objects.create(
            apartment=self.a2,
            month=month,
            invoice_total=Decimal("222.00"),
            paid_total=Decimal("100.00"),
            outstanding_balance=Decimal("122.00"),
            status=Invoice.Status.PAID,
        )

        first = self.client.post(reverse("invoices-send-monthly-invoices"), {"month": month}, format="json")
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(first.data["sent"], 2)
        self.assertEqual(first.data["failed"], 0)
        self.assertEqual(first.data["skipped"], 0)
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(
            InvoiceDocument.objects.filter(document_type=InvoiceDocument.DocumentType.INVOICE, invoice__month=month).count(),
            2,
        )
        self.assertEqual(
            NotificationDispatch.objects.filter(
                notification_type=NotificationDispatch.NotificationType.INVOICE_MONTHLY,
                invoice__month=month,
                status=NotificationDispatch.Status.SENT,
            ).count(),
            2,
        )

        second = self.client.post(reverse("invoices-send-monthly-invoices"), {"month": month}, format="json")
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(second.data["sent"], 0)
        self.assertEqual(second.data["failed"], 0)
        self.assertEqual(second.data["skipped"], 2)

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_retry_failed_notifications_retries_monthly_invoice_dispatch(self):
        month = "2026-08"
        tenant = User.objects.create_user(username="tenant_retry", password="pass1234", email="retry@example.com")
        self.a1.memberships.create(user=tenant, is_owner=True, is_tenant=False)
        invoice = Invoice.objects.create(
            apartment=self.a1,
            month=month,
            invoice_total=Decimal("99.00"),
            paid_total=Decimal("0.00"),
            outstanding_balance=Decimal("99.00"),
            status=Invoice.Status.ISSUED,
        )
        NotificationDispatch.objects.create(
            invoice=invoice,
            notification_type=NotificationDispatch.NotificationType.INVOICE_MONTHLY,
            recipient_email=tenant.email,
            status=NotificationDispatch.Status.FAILED,
            error_message="simulated",
        )

        response = self.client.post(
            reverse("invoices-retry-failed-notifications"),
            {"month": month, "notification_type": NotificationDispatch.NotificationType.INVOICE_MONTHLY},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["retried"], 1)
        self.assertEqual(response.data["sent"], 1)
        self.assertEqual(response.data["failed"], 0)
        self.assertEqual(response.data["skipped"], 0)
        self.assertEqual(len(mail.outbox), 1)
        self.assertTrue(
            NotificationDispatch.objects.filter(
                invoice=invoice,
                notification_type=NotificationDispatch.NotificationType.INVOICE_MONTHLY,
                status=NotificationDispatch.Status.SENT,
            ).exists()
        )

    def test_admin_can_create_vote_session(self):
        now = timezone.now()
        payload = {
            "building": self.building.id,
            "session_type": VoteSession.SessionType.MOTION,
            "title": "Έγκριση δαπάνης",
            "description": "Ψήφος για έκτακτη δαπάνη",
            "start_at": (now - timedelta(hours=1)).isoformat(),
            "end_at": (now + timedelta(days=1)).isoformat(),
            "status": VoteSession.Status.ACTIVE,
        }
        response = self.client.post(reverse("voting-sessions-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(VoteSession.objects.count(), 1)
        self.assertEqual(VoteSession.objects.first().created_by_user, self.admin)

    def test_designated_voter_can_cast_vote_once(self):
        voter = User.objects.create_user(username="voter_a1", password="pass1234", role=User.Role.USER)
        ApartmentUser.objects.create(apartment=self.a1, user=voter, is_owner=True, is_tenant=False)
        DesignatedVoter.objects.create(apartment=self.a1, voter_user=voter)

        session = VoteSession.objects.create(
            building=self.building,
            session_type=VoteSession.SessionType.MOTION,
            title="Θέμα",
            start_at=timezone.now() - timedelta(hours=1),
            end_at=timezone.now() + timedelta(hours=1),
            status=VoteSession.Status.ACTIVE,
            created_by_user=self.admin,
        )

        self.client.force_authenticate(user=voter)
        first = self.client.post(
            reverse("voting-sessions-votes", args=[session.id]),
            {"apartment_id": self.a1.id, "vote_value": Vote.Value.YES},
            format="json",
        )
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(Vote.objects.filter(vote_session=session, apartment=self.a1).count(), 1)
        self.assertEqual(Vote.objects.get(vote_session=session, apartment=self.a1).vote_value, Vote.Value.YES)

        second = self.client.post(
            reverse("voting-sessions-votes", args=[session.id]),
            {"apartment_id": self.a1.id, "vote_value": Vote.Value.NO},
            format="json",
        )
        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(Vote.objects.filter(vote_session=session, apartment=self.a1).count(), 1)
        self.assertEqual(Vote.objects.get(vote_session=session, apartment=self.a1).vote_value, Vote.Value.YES)

    def test_non_designated_user_cannot_vote_for_apartment(self):
        user = User.objects.create_user(username="tenant_a1_readonly", password="pass1234", role=User.Role.USER)
        ApartmentUser.objects.create(apartment=self.a1, user=user, is_owner=False, is_tenant=True)
        DesignatedVoter.objects.create(apartment=self.a1, voter_user=self.admin)

        session = VoteSession.objects.create(
            building=self.building,
            session_type=VoteSession.SessionType.MOTION,
            title="Θέμα",
            start_at=timezone.now() - timedelta(hours=1),
            end_at=timezone.now() + timedelta(hours=1),
            status=VoteSession.Status.ACTIVE,
            created_by_user=self.admin,
        )

        self.client.force_authenticate(user=user)
        response = self.client.post(
            reverse("voting-sessions-votes", args=[session.id]),
            {"apartment_id": self.a1.id, "vote_value": Vote.Value.YES},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Vote.objects.filter(vote_session=session, apartment=self.a1).exists())

    def test_results_available_anytime_with_permille(self):
        session = VoteSession.objects.create(
            building=self.building,
            session_type=VoteSession.SessionType.MOTION,
            title="Θέμα",
            start_at=timezone.now() - timedelta(hours=1),
            end_at=timezone.now() + timedelta(hours=2),
            status=VoteSession.Status.ACTIVE,
            created_by_user=self.admin,
        )
        Vote.objects.create(vote_session=session, apartment=self.a1, voter_user=self.admin, vote_value=Vote.Value.YES)
        Vote.objects.create(vote_session=session, apartment=self.a2, voter_user=self.admin, vote_value=Vote.Value.ABSTAIN)

        response = self.client.get(reverse("voting-sessions-results", args=[session.id]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["counts"]["yes"], 1)
        self.assertEqual(response.data["counts"]["no"], 0)
        self.assertEqual(response.data["counts"]["abstain"], 1)
        self.assertEqual(response.data["permille"]["yes"], Decimal("500.0"))
        self.assertEqual(response.data["permille"]["abstain"], Decimal("500.0"))
        self.assertEqual(response.data["permille"]["no"], Decimal("0.0"))
        self.assertEqual(response.data["permille"]["submitted_total"], Decimal("1000.0"))
        self.assertEqual(response.data["permille"]["eligible_total"], Decimal("1000.0"))

    def test_custom_vote_options_accept_valid_and_reject_invalid_choice(self):
        voter = User.objects.create_user(username="voter_custom", password="pass1234", role=User.Role.USER)
        ApartmentUser.objects.create(apartment=self.a1, user=voter, is_owner=True, is_tenant=False)
        DesignatedVoter.objects.create(apartment=self.a1, voter_user=voter)
        session = VoteSession.objects.create(
            building=self.building,
            session_type=VoteSession.SessionType.MOTION,
            title="Επιλογή προσφοράς",
            vote_options_json=["Προσφορά Α", "Προσφορά Β", "Λευκό"],
            start_at=timezone.now() - timedelta(hours=1),
            end_at=timezone.now() + timedelta(hours=1),
            status=VoteSession.Status.ACTIVE,
            created_by_user=self.admin,
        )

        self.client.force_authenticate(user=voter)
        valid = self.client.post(
            reverse("voting-sessions-votes", args=[session.id]),
            {"apartment_id": self.a1.id, "vote_value": "Προσφορά Β"},
            format="json",
        )
        self.assertEqual(valid.status_code, status.HTTP_200_OK)
        self.assertEqual(Vote.objects.get(vote_session=session, apartment=self.a1).vote_value, "Προσφορά Β")

        other_apartment = Apartment.objects.create(
            building=self.building,
            unit_code="A3",
            ownership_permille=Decimal("0"),
            heating_e_factor=Decimal("0.1"),
            heating_f_factor=Decimal("0.2"),
        )
        ApartmentUser.objects.create(apartment=other_apartment, user=voter, is_owner=True, is_tenant=False)
        DesignatedVoter.objects.create(apartment=other_apartment, voter_user=voter)
        invalid = self.client.post(
            reverse("voting-sessions-votes", args=[session.id]),
            {"apartment_id": other_apartment.id, "vote_value": "Μη έγκυρη επιλογή"},
            format="json",
        )
        self.assertEqual(invalid.status_code, status.HTTP_400_BAD_REQUEST)

    def test_results_return_dynamic_counts_for_custom_options(self):
        session = VoteSession.objects.create(
            building=self.building,
            session_type=VoteSession.SessionType.MOTION,
            title="Επιλογή έργου",
            vote_options_json=["Σενάριο Α", "Σενάριο Β"],
            start_at=timezone.now() - timedelta(days=2),
            end_at=timezone.now() - timedelta(hours=1),
            status=VoteSession.Status.CLOSED,
            created_by_user=self.admin,
        )
        Vote.objects.create(vote_session=session, apartment=self.a1, voter_user=self.admin, vote_value="Σενάριο Α")
        Vote.objects.create(vote_session=session, apartment=self.a2, voter_user=self.admin, vote_value="Σενάριο Β")

        response = self.client.get(reverse("voting-sessions-results", args=[session.id]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["counts"]["Σενάριο Α"], 1)
        self.assertEqual(response.data["counts"]["Σενάριο Β"], 1)
        self.assertEqual(response.data["permille"]["Σενάριο Α"], Decimal("500.0"))
        self.assertEqual(response.data["permille"]["Σενάριο Β"], Decimal("500.0"))

    def test_superadmin_can_assign_designated_voter(self):
        superadmin = User.objects.create_user(
            username="superadmin_assign",
            password="pass1234",
            role=User.Role.SUPERADMIN,
        )
        candidate = User.objects.create_user(username="candidate_voter", password="pass1234", role=User.Role.USER)
        ApartmentUser.objects.create(apartment=self.a1, user=candidate, is_owner=True, is_tenant=False)

        self.client.force_authenticate(user=superadmin)
        response = self.client.put(
            reverse("apartments-designated-voter", args=[self.a1.id]),
            {"voter_user_id": candidate.id},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(DesignatedVoter.objects.filter(apartment=self.a1, voter_user=candidate).exists())


class ApartmentPersonalScopeTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin_scope",
            password="pass1234",
            role=User.Role.ADMINISTRATOR,
        )
        self.building = Building.objects.create(name="Scope B1")
        self.linked = Apartment.objects.create(
            building=self.building,
            unit_code="A1",
            ownership_permille=Decimal("500"),
            heating_e_factor=Decimal("0.10"),
            heating_f_factor=Decimal("0.30"),
        )
        self.other = Apartment.objects.create(
            building=self.building,
            unit_code="A2",
            ownership_permille=Decimal("500"),
            heating_e_factor=Decimal("0.20"),
            heating_f_factor=Decimal("0.20"),
        )
        ApartmentUser.objects.create(apartment=self.linked, user=self.admin, is_owner=True, is_tenant=False)
        self.client.force_authenticate(user=self.admin)

    def test_admin_default_returns_only_linked_apartments(self):
        all_response = self.client.get(f"{reverse('apartments-list')}?all=1")
        self.assertEqual(all_response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(all_response.data), 2)

        linked_response = self.client.get(reverse("apartments-list"))
        self.assertEqual(linked_response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(linked_response.data), 1)
        self.assertEqual(linked_response.data[0]["id"], self.linked.id)


class AdminDestructiveOperationsTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin_destructive",
            password="pass1234",
            role=User.Role.ADMINISTRATOR,
        )
        self.regular = User.objects.create_user(
            username="regular_user",
            password="pass1234",
            role=User.Role.USER,
        )
        self.building = Building.objects.create(name="Destructive B1")
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
            heating_e_factor=Decimal("0.10"),
            heating_f_factor=Decimal("0.30"),
        )
        ApartmentUser.objects.create(apartment=self.a1, user=self.regular, is_owner=True, is_tenant=False)
        self.client.force_authenticate(user=self.admin)

    def test_regular_user_cannot_delete_measurements_by_date(self):
        measurement_date = date(2026, 8, 1)
        heating = HeatingMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=measurement_date,
            e_factor=Decimal("0.10"),
            f_factor=Decimal("0.30"),
            units_counted=Decimal("10"),
            computed_radiator_heating_energy=Decimal("0.03"),
            created_by_user=self.admin,
        )
        self.client.force_authenticate(user=self.regular)
        response = self.client.delete(
            f"{reverse('heating-inputs-delete-by-date')}?measurement_date={measurement_date.isoformat()}"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(HeatingMeasurementInput.objects.filter(id=heating.id).exists())

    def test_admin_deletes_measurements_by_date(self):
        measurement_date = date(2026, 8, 1)
        HeatingMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=measurement_date,
            e_factor=Decimal("0.10"),
            f_factor=Decimal("0.30"),
            units_counted=Decimal("10"),
            computed_radiator_heating_energy=Decimal("0.03"),
            created_by_user=self.admin,
        )
        HeatedWaterMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=measurement_date,
            computed_heating_water_volume=Decimal("5"),
            created_by_user=self.admin,
        )

        response = self.client.delete(
            f"{reverse('heating-inputs-delete-by-date')}?measurement_date={measurement_date.isoformat()}"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(HeatingMeasurementInput.objects.filter(apartment=self.a1, measurement_date=measurement_date).count(), 0)
        self.assertEqual(
            HeatedWaterMeasurementInput.objects.filter(apartment=self.a1, measurement_date=measurement_date).count(),
            0,
        )

    def test_delete_measurements_blocked_when_month_has_paid_invoices(self):
        measurement_date = date(2026, 9, 1)
        HeatingMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=measurement_date,
            e_factor=Decimal("0.10"),
            f_factor=Decimal("0.30"),
            units_counted=Decimal("10"),
            computed_radiator_heating_energy=Decimal("0.03"),
            created_by_user=self.admin,
        )
        invoice = Invoice.objects.create(
            apartment=self.a1,
            month="2026-09",
            invoice_total=Decimal("80.00"),
            paid_total=Decimal("20.00"),
            outstanding_balance=Decimal("60.00"),
            status=Invoice.Status.ISSUED,
        )
        PaymentRecord.objects.create(
            invoice=invoice,
            apartment=self.a1,
            amount=Decimal("20.00"),
            payment_date=date(2026, 9, 15),
            created_by_user=self.admin,
        )

        response = self.client.delete(
            f"{reverse('heating-inputs-delete-by-date')}?measurement_date={measurement_date.isoformat()}"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(HeatingMeasurementInput.objects.filter(apartment=self.a1, measurement_date=measurement_date).count(), 1)

    def test_payment_delete_recalculates_invoice_balances(self):
        invoice = Invoice.objects.create(
            apartment=self.a1,
            month="2026-10",
            invoice_total=Decimal("100.00"),
            paid_total=Decimal("100.00"),
            outstanding_balance=Decimal("0.00"),
            status=Invoice.Status.PAID,
        )
        payment = PaymentRecord.objects.create(
            invoice=invoice,
            apartment=self.a1,
            amount=Decimal("100.00"),
            payment_date=date(2026, 10, 10),
            created_by_user=self.admin,
        )

        response = self.client.delete(reverse("payments-detail", args=[payment.id]))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

        invoice.refresh_from_db()
        self.assertEqual(invoice.paid_total, Decimal("0.00"))
        self.assertEqual(invoice.outstanding_balance, Decimal("100.00"))
        self.assertEqual(invoice.status, Invoice.Status.ISSUED)

    def test_regular_user_cannot_delete_payment(self):
        invoice = Invoice.objects.create(
            apartment=self.a1,
            month="2026-11",
            invoice_total=Decimal("50.00"),
            paid_total=Decimal("50.00"),
            outstanding_balance=Decimal("0.00"),
            status=Invoice.Status.PAID,
        )
        payment = PaymentRecord.objects.create(
            invoice=invoice,
            apartment=self.a1,
            amount=Decimal("50.00"),
            payment_date=date(2026, 11, 10),
            created_by_user=self.admin,
        )
        self.client.force_authenticate(user=self.regular)
        response = self.client.delete(reverse("payments-detail", args=[payment.id]))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_recall_month_cascades_payments_and_deletes_all_invoices(self):
        invoice_a1 = Invoice.objects.create(
            apartment=self.a1,
            month="2026-12",
            invoice_total=Decimal("90.00"),
            paid_total=Decimal("40.00"),
            outstanding_balance=Decimal("50.00"),
            status=Invoice.Status.ISSUED,
        )
        invoice_a2 = Invoice.objects.create(
            apartment=self.a2,
            month="2026-12",
            invoice_total=Decimal("60.00"),
            paid_total=Decimal("0.00"),
            outstanding_balance=Decimal("60.00"),
            status=Invoice.Status.ISSUED,
        )
        other_month = Invoice.objects.create(
            apartment=self.a1,
            month="2027-01",
            invoice_total=Decimal("30.00"),
            paid_total=Decimal("0.00"),
            outstanding_balance=Decimal("30.00"),
            status=Invoice.Status.ISSUED,
        )
        payment = PaymentRecord.objects.create(
            invoice=invoice_a1,
            apartment=self.a1,
            amount=Decimal("40.00"),
            payment_date=date(2026, 12, 5),
            created_by_user=self.admin,
        )
        InvoiceDocument.objects.create(
            invoice=invoice_a1,
            payment=payment,
            document_type=InvoiceDocument.DocumentType.RECEIPT,
            file_name="receipt.pdf",
            mime_type="application/pdf",
            content=b"%PDF-1.4 test",
        )

        response = self.client.post(reverse("invoices-recall-month"), {"month": "2026-12", "confirm": True}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["invoices_deleted"], 2)
        self.assertFalse(Invoice.objects.filter(id=invoice_a1.id).exists())
        self.assertFalse(Invoice.objects.filter(id=invoice_a2.id).exists())
        self.assertTrue(Invoice.objects.filter(id=other_month.id).exists())
        self.assertEqual(PaymentRecord.objects.filter(id=payment.id).count(), 0)
        self.assertEqual(InvoiceDocument.objects.filter(invoice_id=invoice_a1.id).count(), 0)

    def test_recall_month_requires_confirmation(self):
        Invoice.objects.create(
            apartment=self.a1,
            month="2027-01",
            invoice_total=Decimal("30.00"),
            paid_total=Decimal("0.00"),
            outstanding_balance=Decimal("30.00"),
            status=Invoice.Status.ISSUED,
        )
        response = self.client.post(reverse("invoices-recall-month"), {"month": "2027-01"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(Invoice.objects.filter(month="2027-01").exists())

    def test_admin_deletes_expense(self):
        expense = ExpenseItem.objects.create(
            building=self.building,
            expense_category=ExpenseItem.Category.GAS_HEATING,
            expense_date=date(2026, 8, 10),
            month="2026-08",
            amount=Decimal("120.00"),
            created_by_user=self.admin,
        )
        response = self.client.delete(reverse("expenses-detail", args=[expense.id]))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(ExpenseItem.objects.filter(id=expense.id).exists())

    def test_regular_user_cannot_delete_expense(self):
        expense = ExpenseItem.objects.create(
            building=self.building,
            expense_category=ExpenseItem.Category.GAS_HEATING,
            expense_date=date(2026, 8, 10),
            month="2026-08",
            amount=Decimal("120.00"),
            created_by_user=self.admin,
        )
        self.client.force_authenticate(user=self.regular)
        response = self.client.delete(reverse("expenses-detail", args=[expense.id]))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(ExpenseItem.objects.filter(id=expense.id).exists())

    def _create_measurement(self, measurement_date, reading):
        HeatingMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=measurement_date,
            e_factor=Decimal("0.10"),
            f_factor=Decimal("0.30"),
            current_reading=Decimal(reading),
            units_counted=Decimal(reading),
            computed_radiator_heating_energy=Decimal("0.03"),
            created_by_user=self.admin,
        )
        HeatedWaterMeasurementInput.objects.create(
            apartment=self.a1,
            measurement_date=measurement_date,
            current_reading=Decimal(reading),
            computed_heating_water_volume=Decimal(reading),
            created_by_user=self.admin,
        )
        BuildingMeasurementInput.objects.create(
            building=self.building,
            measurement_date=measurement_date,
            hot_water_heating_current_reading=Decimal(reading),
            hot_water_heating_units=Decimal(reading),
            created_by_user=self.admin,
        )

    def test_admin_edits_measurements_when_not_allocated(self):
        measurement_date = date(2026, 10, 1)
        self._create_measurement(measurement_date, "10")

        response = self.client.post(
            reverse("heating-inputs-monthly-upsert"),
            {
                "measurement_date": measurement_date.isoformat(),
                "building_hot_water_heating_reading": "20",
                "rows": [
                    {
                        "apartment_id": self.a1.id,
                        "heating_current_reading": "25",
                        "heated_water_current_reading": "18",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        heating = HeatingMeasurementInput.objects.get(apartment=self.a1, measurement_date=measurement_date)
        water = HeatedWaterMeasurementInput.objects.get(apartment=self.a1, measurement_date=measurement_date)
        building = BuildingMeasurementInput.objects.get(building=self.building, measurement_date=measurement_date)
        self.assertEqual(heating.current_reading, Decimal("25.0"))
        self.assertEqual(water.current_reading, Decimal("18.0"))
        self.assertEqual(building.hot_water_heating_current_reading, Decimal("20.0"))

    def test_edit_measurements_blocked_when_month_allocated(self):
        measurement_date = date(2026, 11, 1)
        self._create_measurement(measurement_date, "10")
        Invoice.objects.create(
            apartment=self.a1,
            month="2026-11",
            invoice_total=Decimal("50.00"),
            paid_total=Decimal("0.00"),
            outstanding_balance=Decimal("50.00"),
            status=Invoice.Status.ISSUED,
        )

        response = self.client.post(
            reverse("heating-inputs-monthly-upsert"),
            {
                "measurement_date": measurement_date.isoformat(),
                "building_hot_water_heating_reading": "20",
                "rows": [
                    {
                        "apartment_id": self.a1.id,
                        "heating_current_reading": "25",
                        "heated_water_current_reading": "18",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        heating = HeatingMeasurementInput.objects.get(apartment=self.a1, measurement_date=measurement_date)
        self.assertEqual(heating.current_reading, Decimal("10.0000"))

    def test_date_detail_reports_locked(self):
        measurement_date = date(2026, 12, 1)
        self._create_measurement(measurement_date, "10")
        Invoice.objects.create(
            apartment=self.a1,
            month="2026-12",
            invoice_total=Decimal("50.00"),
            paid_total=Decimal("0.00"),
            outstanding_balance=Decimal("50.00"),
            status=Invoice.Status.ISSUED,
        )

        response = self.client.get(
            f"{reverse('heating-inputs-date-detail')}?measurement_date={measurement_date.isoformat()}"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["locked"])


class BuildingFundBalanceTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin_fund",
            password="pass1234",
            role=User.Role.ADMINISTRATOR,
        )
        self.user = User.objects.create_user(
            username="tenant_fund",
            password="pass1234",
            role=User.Role.USER,
        )
        self.building = Building.objects.create(name="Fund B1", fund_balance=Decimal("4500.00"))

    def test_authenticated_user_can_read_building_fund_balance(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(reverse("buildings-detail", args=[self.building.id]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["fund_balance"], "4500.00")

    def test_admin_can_update_building_fund_balance(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.patch(
            reverse("buildings-detail", args=[self.building.id]),
            {"fund_balance": "5200.50"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["fund_balance"], "5200.50")
        self.building.refresh_from_db()
        self.assertEqual(self.building.fund_balance, Decimal("5200.50"))

    def test_regular_user_cannot_update_building_fund_balance(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.patch(
            reverse("buildings-detail", args=[self.building.id]),
            {"fund_balance": "100.00"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.building.refresh_from_db()
        self.assertEqual(self.building.fund_balance, Decimal("4500.00"))


class FundIncreaseExpenseTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin_fund_inc",
            password="pass1234",
            role=User.Role.ADMINISTRATOR,
        )
        self.client.force_authenticate(user=self.admin)
        self.building = Building.objects.create(name="FundInc B1", fund_balance=Decimal("1000.00"))

    def test_fund_increase_expense_adds_to_building_balance(self):
        response = self.client.post(
            reverse("expenses-list"),
            {
                "building": self.building.id,
                "expense_category": ExpenseItem.Category.FUND_INCREASE,
                "expense_date": "2026-07-01",
                "amount": "250.00",
                "description": "Εισφορά ιδιοκτητών",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.building.refresh_from_db()
        self.assertEqual(self.building.fund_balance, Decimal("1250.00"))

    def test_fund_increase_expense_delete_reverses_balance(self):
        expense = ExpenseItem.objects.create(
            building=self.building,
            expense_category=ExpenseItem.Category.FUND_INCREASE,
            expense_date=date(2026, 7, 1),
            amount=Decimal("250.00"),
            created_by_user=self.admin,
        )
        self.building.fund_balance = Decimal("1250.00")
        self.building.save(update_fields=["fund_balance", "updated_at"])

        response = self.client.delete(reverse("expenses-detail", args=[expense.id]))
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.building.refresh_from_db()
        self.assertEqual(self.building.fund_balance, Decimal("1000.00"))

    def test_fund_increase_excluded_from_invoice_allocation(self):
        month = "2026-07"
        ExpenseItem.objects.create(
            building=self.building,
            expense_category=ExpenseItem.Category.FUND_INCREASE,
            expense_date=date(2026, 7, 5),
            amount=Decimal("300.00"),
            created_by_user=self.admin,
        )
        self.building.fund_balance = Decimal("1300.00")
        self.building.save(update_fields=["fund_balance", "updated_at"])

        Apartment.objects.create(
            building=self.building,
            unit_code="A1",
            ownership_permille=Decimal("1000"),
            heating_e_factor=Decimal("0.10"),
            heating_f_factor=Decimal("0.20"),
        )

        from flats.views import _calculate_invoice_rows

        result, error = _calculate_invoice_rows(month)
        self.assertIsNone(error)
        _, rows, breakdown = result
        self.assertTrue(all(sum(row.values()) == Decimal("0") for row in rows.values()))
        self.assertTrue(all(len(lines) == 0 for lines in breakdown.values()))
