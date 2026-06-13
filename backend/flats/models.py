from django.db import models
from django.conf import settings
from decimal import Decimal


class Building(models.Model):
    name = models.CharField(max_length=255)
    fund_balance = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return self.name


class Apartment(models.Model):
    building = models.ForeignKey(Building, on_delete=models.CASCADE, related_name="apartments")
    unit_code = models.CharField(max_length=64)
    owner_name = models.CharField(max_length=255, blank=True, default="")
    ownership_permille = models.DecimalField(max_digits=7, decimal_places=3)
    heating_e_factor = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    heating_f_factor = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("building", "unit_code")

    @property
    def apartment_label(self) -> str:
        if not self.owner_name:
            return self.unit_code
        normalized_owner = "-".join(self.owner_name.strip().upper().split())
        return f"{self.unit_code}-{normalized_owner}"

    def __str__(self) -> str:
        return f"{self.building.name} / {self.apartment_label}"


class ApartmentUser(models.Model):
    apartment = models.ForeignKey(Apartment, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="apartment_memberships")
    is_tenant = models.BooleanField(
        default=True,
        help_text="User has access as a resident (tenant) of this apartment.",
    )
    is_owner = models.BooleanField(
        default=False,
        help_text="User is recorded as owner of this apartment.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("apartment", "user")

    def __str__(self) -> str:
        roles: list[str] = []
        if self.is_tenant:
            roles.append("tenant")
        if self.is_owner:
            roles.append("owner")
        role_label = ", ".join(roles) if roles else "no role"
        return f"{self.user} → {self.apartment} ({role_label})"


class DesignatedVoter(models.Model):
    apartment = models.OneToOneField(Apartment, on_delete=models.CASCADE, related_name="designated_voter")
    voter_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="designated_votes")
    effective_from = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.apartment} — voter: {self.voter_user}"


class VoteSession(models.Model):
    class SessionType(models.TextChoices):
        ADMINISTRATOR_ELECTION = "administrator_election", "Εκλογή διαχειριστή"
        MOTION = "motion", "Θέμα ψηφοφορίας"

    class Status(models.TextChoices):
        DRAFT = "draft", "Πρόχειρη"
        ACTIVE = "active", "Ενεργή"
        CLOSED = "closed", "Κλειστή"

    building = models.ForeignKey(Building, on_delete=models.CASCADE, related_name="vote_sessions")
    session_type = models.CharField(max_length=32, choices=SessionType.choices, default=SessionType.MOTION)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    vote_options_json = models.JSONField(default=list, blank=True)
    start_at = models.DateTimeField()
    end_at = models.DateTimeField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    created_by_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.title} ({self.session_type})"


class Vote(models.Model):
    class Value(models.TextChoices):
        YES = "yes", "Ναι"
        NO = "no", "Όχι"
        ABSTAIN = "abstain", "Αποχή"

    vote_session = models.ForeignKey(VoteSession, on_delete=models.CASCADE, related_name="votes")
    apartment = models.ForeignKey(Apartment, on_delete=models.CASCADE, related_name="votes")
    voter_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    vote_value = models.CharField(max_length=64)
    submitted_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["vote_session", "apartment"], name="uniq_vote_session_apartment"),
        ]

    def __str__(self) -> str:
        return f"{self.apartment} @ {self.vote_session}: {self.vote_value}"


class HeatingMeasurementInput(models.Model):
    apartment = models.ForeignKey(Apartment, on_delete=models.CASCADE, related_name="heating_inputs")
    measurement_date = models.DateField()
    e_factor = models.DecimalField(max_digits=10, decimal_places=4)
    f_factor = models.DecimalField(max_digits=10, decimal_places=4)
    current_reading = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    units_counted = models.DecimalField(max_digits=12, decimal_places=4)
    computed_radiator_heating_energy = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    created_by_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("apartment", "measurement_date")

    def __str__(self) -> str:
        return f"{self.apartment} · heating · {self.measurement_date}"


class HeatedWaterMeasurementInput(models.Model):
    apartment = models.ForeignKey(Apartment, on_delete=models.CASCADE, related_name="heated_water_inputs")
    measurement_date = models.DateField()
    inputs_json = models.JSONField(default=dict, blank=True)
    current_reading = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    computed_heating_water_volume = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    created_by_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("apartment", "measurement_date")

    def __str__(self) -> str:
        return f"{self.apartment} · hot water · {self.measurement_date}"


class BuildingMeasurementInput(models.Model):
    building = models.ForeignKey(Building, on_delete=models.CASCADE, related_name="building_measurements")
    measurement_date = models.DateField()
    hot_water_heating_current_reading = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    hot_water_heating_units = models.DecimalField(max_digits=12, decimal_places=4, default=0)
    created_by_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("building", "measurement_date")

    def __str__(self) -> str:
        return f"{self.building} · boiler HW · {self.measurement_date}"


class ExpenseItem(models.Model):
    class Category(models.TextChoices):
        GARDENER = "gardener", "Κηπουρός"
        COMMON_POWER = "common_power_usage", "Κοινόχρηστο ρεύμα"
        COMMON_WATER = "common_water_usage", "Κοινόχρηστο νερό"
        CLEANING = "cleaning", "Καθαρισμός"
        ELEVATOR = "elevator_service", "Συντήρηση ανελκυστήρα"
        GAS_HEATING = "gas_heating_bill", "Φυσικό αέριο (συνολικό)"
        WATER_HW_CONSUMPTION = "water_hw_consumption_bill", "Κατανάλωση ζεστού νερού"
        GAS_HW_CONSUMPTION = "gas_hw_consumption_bill", "Φυσικο αέριο ζεστού νερού"
        DAMAGES = "damages", "Ζημιές"
        ANNUAL_SERVICING = "annual_servicing", "Ετήσια συντήρηση"
        OWNERS_ONLY = "owners_only", "Έξοδα μόνο ιδιοκτητών"
        FUND_INCREASE = "fund_increase", "Αύξηση αποθεματικού"
        OTHER = "other", "Λοιπά"

    building = models.ForeignKey(Building, on_delete=models.CASCADE, related_name="expenses")
    expense_category = models.CharField(max_length=64, choices=Category.choices)
    expense_date = models.DateField()
    month = models.CharField(max_length=7, blank=True)  # YYYY-MM
    affected_period_start = models.DateField(null=True, blank=True)
    affected_period_end = models.DateField(null=True, blank=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    description = models.TextField(blank=True)
    created_by_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        self.month = self.expense_date.strftime("%Y-%m")
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.get_expense_category_display()} · {self.month} · {self.amount}"


class Invoice(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Πρόχειρο"
        ISSUED = "issued", "Εκδομένο"
        PAID = "paid", "Εξοφλημένο"

    apartment = models.ForeignKey(Apartment, on_delete=models.CASCADE, related_name="invoices")
    month = models.CharField(max_length=7)  # YYYY-MM
    heating_radiators_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    heated_water_energy_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    water_consumption_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    common_recurring_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    common_non_recurring_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    owners_only_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    custom_adjustment = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    custom_adjustment_note = models.TextField(blank=True)
    invoice_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    paid_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    outstanding_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    issued_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("apartment", "month")

    def __str__(self) -> str:
        return f"{self.apartment} · {self.month} · {self.get_status_display()} · {self.invoice_total}"


class PaymentRecord(models.Model):
    class Method(models.TextChoices):
        CASH = "cash", "Μετρητά"
        BANK_TRANSFER = "bank_transfer", "Τραπεζική μεταφορά"
        CARD = "card", "Κάρτα"
        OTHER = "other", "Άλλο"

    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="payments")
    apartment = models.ForeignKey(Apartment, on_delete=models.CASCADE, related_name="payments")
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    payment_date = models.DateField()
    method = models.CharField(max_length=32, choices=Method.choices, default=Method.BANK_TRANSFER)
    reference = models.CharField(max_length=128, blank=True)
    notes = models.TextField(blank=True)
    created_by_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"{self.apartment} · {self.payment_date} · {self.amount} ({self.get_method_display()})"


class InvoiceDocument(models.Model):
    class DocumentType(models.TextChoices):
        INVOICE = "invoice", "Τιμολόγιο"
        RECEIPT = "receipt", "Απόδειξη πληρωμής"

    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="documents")
    payment = models.ForeignKey(PaymentRecord, on_delete=models.CASCADE, related_name="documents", null=True, blank=True)
    document_type = models.CharField(max_length=32, choices=DocumentType.choices)
    file_name = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=127, default="application/pdf")
    content = models.BinaryField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"{self.get_document_type_display()} · {self.invoice} · {self.file_name}"


class NotificationDispatch(models.Model):
    class NotificationType(models.TextChoices):
        RECEIPT_PAID = "receipt_paid", "Απόδειξη εξόφλησης"
        INVOICE_MONTHLY = "invoice_monthly", "Μηνιαία αποστολή λογαριασμού"

    class Status(models.TextChoices):
        QUEUED = "queued", "Σε αναμονή"
        SENT = "sent", "Εστάλη"
        FAILED = "failed", "Απέτυχε"
        SKIPPED = "skipped", "Παραλείφθηκε"

    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="notification_dispatches")
    payment = models.ForeignKey(PaymentRecord, on_delete=models.CASCADE, related_name="notification_dispatches", null=True, blank=True)
    notification_type = models.CharField(max_length=32, choices=NotificationType.choices)
    recipient_email = models.EmailField(blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.QUEUED)
    error_message = models.TextField(blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"{self.get_notification_type_display()} · {self.invoice} · {self.get_status_display()}"
