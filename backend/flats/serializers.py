from rest_framework import serializers

from .models import (
    Apartment,
    ExpenseItem,
    HeatingMeasurementInput,
    HeatedWaterMeasurementInput,
    Invoice,
    InvoiceDocument,
    NotificationDispatch,
    PaymentRecord,
)


class ApartmentSerializer(serializers.ModelSerializer):
    building_name = serializers.CharField(source="building.name", read_only=True)
    apartment_label = serializers.CharField(read_only=True)

    class Meta:
        model = Apartment
        fields = [
            "id",
            "building",
            "building_name",
            "unit_code",
            "owner_name",
            "apartment_label",
            "ownership_permille",
            "heating_e_factor",
            "heating_f_factor",
        ]


class ApartmentHeatingFactorsSerializer(serializers.Serializer):
    heating_e_factor = serializers.DecimalField(max_digits=10, decimal_places=4)
    heating_f_factor = serializers.DecimalField(max_digits=10, decimal_places=4)


class HeatingMeasurementInputSerializer(serializers.ModelSerializer):
    class Meta:
        model = HeatingMeasurementInput
        fields = [
            "id",
            "apartment",
            "measurement_date",
            "billing_period_start",
            "billing_period_end",
            "e_factor",
            "f_factor",
            "current_reading",
            "units_counted",
            "computed_radiator_heating_energy",
            "created_by_user",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["computed_radiator_heating_energy", "created_by_user", "created_at", "updated_at"]

    def create(self, validated_data):
        validated_data["created_by_user"] = self.context["request"].user
        validated_data["computed_radiator_heating_energy"] = validated_data["e_factor"] * validated_data["f_factor"]
        return super().create(validated_data)

    def update(self, instance, validated_data):
        for key, value in validated_data.items():
            setattr(instance, key, value)
        instance.computed_radiator_heating_energy = instance.e_factor * instance.f_factor
        instance.save()
        return instance


class HeatedWaterMeasurementInputSerializer(serializers.ModelSerializer):
    class Meta:
        model = HeatedWaterMeasurementInput
        fields = [
            "id",
            "apartment",
            "measurement_date",
            "billing_period_start",
            "billing_period_end",
            "inputs_json",
            "current_reading",
            "computed_heating_water_volume",
            "created_by_user",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_by_user", "created_at", "updated_at"]

    def create(self, validated_data):
        validated_data["created_by_user"] = self.context["request"].user
        return super().create(validated_data)


class ExpenseItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpenseItem
        fields = [
            "id",
            "building",
            "expense_category",
            "expense_date",
            "month",
            "affected_period_start",
            "affected_period_end",
            "amount",
            "description",
            "created_by_user",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["month", "created_by_user", "created_at", "updated_at"]

    def create(self, validated_data):
        validated_data["created_by_user"] = self.context["request"].user
        return super().create(validated_data)

    def validate(self, attrs):
        category = attrs.get("expense_category", getattr(self.instance, "expense_category", None))
        affected_start = attrs.get("affected_period_start", getattr(self.instance, "affected_period_start", None))
        affected_end = attrs.get("affected_period_end", getattr(self.instance, "affected_period_end", None))

        categories_requiring_range = {
            ExpenseItem.Category.GAS_HEATING,
            ExpenseItem.Category.WATER_HW_CONSUMPTION,
            ExpenseItem.Category.GAS_HW_CONSUMPTION,
        }
        if category in categories_requiring_range and (not affected_start or not affected_end):
            raise serializers.ValidationError(
                "Για θέρμανση/ζεστό νερό απαιτείται εύρος ημερομηνιών μετρήσεων (affected_period_start/affected_period_end)."
            )
        if affected_start and affected_end and affected_start > affected_end:
            raise serializers.ValidationError("Το affected_period_start δεν μπορεί να είναι μετά το affected_period_end.")
        return attrs


class InvoiceSerializer(serializers.ModelSerializer):
    apartment_unit_code = serializers.CharField(source="apartment.apartment_label", read_only=True)

    class Meta:
        model = Invoice
        fields = [
            "id",
            "apartment",
            "apartment_unit_code",
            "month",
            "heating_radiators_total",
            "heated_water_energy_total",
            "water_consumption_total",
            "common_recurring_total",
            "common_non_recurring_total",
            "owners_only_total",
            "invoice_total",
            "paid_total",
            "outstanding_balance",
            "status",
            "issued_at",
            "updated_at",
        ]


class InvoiceGenerateSerializer(serializers.Serializer):
    month = serializers.CharField(max_length=7)

    def validate_month(self, value: str):
        if len(value) != 7 or value[4] != "-":
            raise serializers.ValidationError("Ο μήνας πρέπει να είναι στη μορφή YYYY-MM.")
        return value


class PaymentRecordSerializer(serializers.ModelSerializer):
    apartment_label = serializers.CharField(source="apartment.apartment_label", read_only=True)
    invoice_month = serializers.CharField(source="invoice.month", read_only=True)

    class Meta:
        model = PaymentRecord
        fields = [
            "id",
            "invoice",
            "invoice_month",
            "apartment",
            "apartment_label",
            "amount",
            "payment_date",
            "method",
            "reference",
            "notes",
            "created_by_user",
            "created_at",
        ]
        read_only_fields = ["created_by_user", "created_at", "apartment", "invoice_month", "apartment_label"]

    def validate(self, attrs):
        invoice = attrs.get("invoice", getattr(self.instance, "invoice", None))
        amount = attrs.get("amount")
        if amount is not None and amount <= 0:
            raise serializers.ValidationError("Το ποσό πληρωμής πρέπει να είναι θετικό.")
        if invoice and amount is not None and amount > invoice.outstanding_balance:
            raise serializers.ValidationError("Το ποσό πληρωμής δεν μπορεί να υπερβαίνει το υπόλοιπο.")
        return attrs

    def create(self, validated_data):
        validated_data["created_by_user"] = self.context["request"].user
        validated_data["apartment"] = validated_data["invoice"].apartment
        return super().create(validated_data)


class InvoiceMarkPaidSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, required=False)
    payment_date = serializers.DateField(required=False)
    method = serializers.ChoiceField(choices=PaymentRecord.Method.choices, required=False, default=PaymentRecord.Method.BANK_TRANSFER)
    reference = serializers.CharField(required=False, allow_blank=True, max_length=128)
    notes = serializers.CharField(required=False, allow_blank=True)


class InvoiceDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceDocument
        fields = ["id", "invoice", "payment", "document_type", "file_name", "mime_type", "created_at"]


class NotificationDispatchSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationDispatch
        fields = [
            "id",
            "invoice",
            "payment",
            "notification_type",
            "recipient_email",
            "status",
            "error_message",
            "sent_at",
            "created_at",
        ]


class HeatingBulkRowSerializer(serializers.Serializer):
    apartment_id = serializers.IntegerField()
    units_counted = serializers.DecimalField(max_digits=12, decimal_places=1)


class HeatingBulkUpsertSerializer(serializers.Serializer):
    measurement_date = serializers.DateField()
    billing_period_start = serializers.DateField()
    billing_period_end = serializers.DateField()
    rows = HeatingBulkRowSerializer(many=True)


class HeatedWaterBulkRowSerializer(serializers.Serializer):
    apartment_id = serializers.IntegerField()
    computed_heating_water_volume = serializers.DecimalField(max_digits=14, decimal_places=1)
    inputs_json = serializers.JSONField(required=False)


class HeatedWaterBulkUpsertSerializer(serializers.Serializer):
    measurement_date = serializers.DateField()
    billing_period_start = serializers.DateField()
    billing_period_end = serializers.DateField()
    rows = HeatedWaterBulkRowSerializer(many=True)


class MonthlyMeasurementRowSerializer(serializers.Serializer):
    apartment_id = serializers.IntegerField()
    heating_current_reading = serializers.DecimalField(max_digits=14, decimal_places=1)
    heated_water_current_reading = serializers.DecimalField(max_digits=14, decimal_places=1)


class MonthlyMeasurementUpsertSerializer(serializers.Serializer):
    measurement_date = serializers.DateField()
    billing_period_start = serializers.DateField()
    billing_period_end = serializers.DateField()
    rows = MonthlyMeasurementRowSerializer(many=True)
