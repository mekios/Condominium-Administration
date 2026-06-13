from rest_framework import serializers

from .models import (
    Apartment,
    ApartmentUser,
    Building,
    DesignatedVoter,
    ExpenseItem,
    HeatingMeasurementInput,
    HeatedWaterMeasurementInput,
    Invoice,
    InvoiceDocument,
    NotificationDispatch,
    PaymentRecord,
    Vote,
    VoteSession,
)


class BuildingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Building
        fields = ["id", "name", "fund_balance"]
        read_only_fields = ["name"]


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


class DesignatedVoterAssignSerializer(serializers.Serializer):
    voter_user_id = serializers.IntegerField()


class HeatingMeasurementInputSerializer(serializers.ModelSerializer):
    class Meta:
        model = HeatingMeasurementInput
        fields = [
            "id",
            "apartment",
            "measurement_date",
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
        if category == ExpenseItem.Category.FUND_INCREASE:
            attrs["affected_period_start"] = None
            attrs["affected_period_end"] = None
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
            "custom_adjustment",
            "custom_adjustment_note",
            "invoice_total",
            "paid_total",
            "outstanding_balance",
            "status",
            "issued_at",
            "updated_at",
        ]


class InvoiceAdjustmentInputSerializer(serializers.Serializer):
    apartment = serializers.IntegerField()
    amount = serializers.DecimalField(max_digits=14, decimal_places=2)
    note = serializers.CharField(required=False, allow_blank=True, default="", max_length=500)


class InvoiceGenerateSerializer(serializers.Serializer):
    month = serializers.CharField(max_length=7)
    adjustments = InvoiceAdjustmentInputSerializer(many=True, required=False)

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
    rows = HeatingBulkRowSerializer(many=True)


class HeatedWaterBulkRowSerializer(serializers.Serializer):
    apartment_id = serializers.IntegerField()
    computed_heating_water_volume = serializers.DecimalField(max_digits=14, decimal_places=1)
    inputs_json = serializers.JSONField(required=False)


class HeatedWaterBulkUpsertSerializer(serializers.Serializer):
    measurement_date = serializers.DateField()
    rows = HeatedWaterBulkRowSerializer(many=True)


class MonthlyMeasurementRowSerializer(serializers.Serializer):
    apartment_id = serializers.IntegerField()
    heating_current_reading = serializers.DecimalField(max_digits=14, decimal_places=1)
    heated_water_current_reading = serializers.DecimalField(max_digits=14, decimal_places=1)


class MonthlyMeasurementUpsertSerializer(serializers.Serializer):
    measurement_date = serializers.DateField()
    rows = MonthlyMeasurementRowSerializer(many=True)


class VoteSessionSerializer(serializers.ModelSerializer):
    building_name = serializers.CharField(source="building.name", read_only=True)
    created_by_username = serializers.CharField(source="created_by_user.username", read_only=True)

    class Meta:
        model = VoteSession
        fields = [
            "id",
            "building",
            "building_name",
            "session_type",
            "title",
            "description",
            "vote_options_json",
            "start_at",
            "end_at",
            "status",
            "created_by_user",
            "created_by_username",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_by_user", "created_at", "updated_at", "building_name", "created_by_username"]

    def validate(self, attrs):
        start_at = attrs.get("start_at", getattr(self.instance, "start_at", None))
        end_at = attrs.get("end_at", getattr(self.instance, "end_at", None))
        if start_at and end_at and start_at >= end_at:
            raise serializers.ValidationError("Το start_at πρέπει να είναι πριν από το end_at.")
        options = attrs.get("vote_options_json", getattr(self.instance, "vote_options_json", []))
        if options is None:
            options = []
        if not isinstance(options, list):
            raise serializers.ValidationError("Το vote_options_json πρέπει να είναι λίστα επιλογών.")
        normalized: list[str] = []
        seen: set[str] = set()
        for option in options:
            option_text = str(option).strip()
            if not option_text:
                continue
            key = option_text.lower()
            if key in seen:
                continue
            seen.add(key)
            normalized.append(option_text)
        if len(normalized) > 12:
            raise serializers.ValidationError("Μέγιστος αριθμός επιλογών: 12.")
        attrs["vote_options_json"] = normalized
        return attrs

    def create(self, validated_data):
        validated_data["created_by_user"] = self.context["request"].user
        if "status" not in validated_data:
            validated_data["status"] = VoteSession.Status.DRAFT
        return super().create(validated_data)


class VoteSerializer(serializers.ModelSerializer):
    apartment_label = serializers.CharField(source="apartment.apartment_label", read_only=True)
    voter_username = serializers.CharField(source="voter_user.username", read_only=True)

    class Meta:
        model = Vote
        fields = [
            "id",
            "vote_session",
            "apartment",
            "apartment_label",
            "voter_user",
            "voter_username",
            "vote_value",
            "submitted_at",
            "updated_at",
        ]
        read_only_fields = ["submitted_at", "updated_at", "apartment_label", "voter_username", "voter_user"]


class VoteSubmitSerializer(serializers.Serializer):
    apartment_id = serializers.IntegerField()
    vote_value = serializers.CharField(max_length=64)

    def validate(self, attrs):
        request = self.context["request"]
        vote_session: VoteSession = self.context["vote_session"]
        apartment_id = attrs["apartment_id"]

        apartment_user_exists = ApartmentUser.objects.filter(apartment_id=apartment_id, user=request.user).exists()
        if not apartment_user_exists:
            raise serializers.ValidationError("Ο χρήστης δεν είναι συνδεδεμένος με το συγκεκριμένο διαμέρισμα.")

        designated = DesignatedVoter.objects.filter(apartment_id=apartment_id, voter_user=request.user).exists()
        if not designated:
            raise serializers.ValidationError("Μόνο ο ορισμένος ψηφοφόρος μπορεί να ψηφίσει για το διαμέρισμα.")

        if vote_session.building_id != Apartment.objects.filter(id=apartment_id).values_list("building_id", flat=True).first():
            raise serializers.ValidationError("Το διαμέρισμα δεν ανήκει στο κτίριο της ψηφοφορίας.")

        vote_value = str(attrs["vote_value"]).strip()
        if not vote_value:
            raise serializers.ValidationError("Η επιλογή ψήφου είναι υποχρεωτική.")
        available_options = vote_session.vote_options_json or [Vote.Value.YES, Vote.Value.NO, Vote.Value.ABSTAIN]
        available_lookup = {str(option).strip().lower(): str(option).strip() for option in available_options if str(option).strip()}
        selected = available_lookup.get(vote_value.lower())
        if not selected:
            raise serializers.ValidationError("Μη έγκυρη επιλογή ψήφου για αυτή τη συνεδρία.")
        attrs["vote_value"] = selected

        return attrs
