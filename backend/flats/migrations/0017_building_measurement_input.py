from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("flats", "0016_invoice_custom_adjustment"),
    ]

    operations = [
        migrations.CreateModel(
            name="BuildingMeasurementInput",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("measurement_date", models.DateField()),
                ("hot_water_heating_current_reading", models.DecimalField(decimal_places=4, default=0, max_digits=14)),
                ("hot_water_heating_units", models.DecimalField(decimal_places=4, default=0, max_digits=12)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "building",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="building_measurements", to="flats.building"),
                ),
                (
                    "created_by_user",
                    models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to="accounts.user"),
                ),
            ],
            options={
                "unique_together": {("building", "measurement_date")},
            },
        ),
        migrations.AlterField(
            model_name="expenseitem",
            name="expense_category",
            field=models.CharField(
                choices=[
                    ("gardener", "Κηπουρός"),
                    ("common_power_usage", "Κοινόχρηστο ρεύμα"),
                    ("common_water_usage", "Κοινόχρηστο νερό"),
                    ("cleaning", "Καθαρισμός"),
                    ("elevator_service", "Συντήρηση ανελκυστήρα"),
                    ("gas_heating_bill", "Φυσικό αέριο (συνολικό)"),
                    ("water_hw_consumption_bill", "Κατανάλωση ζεστού νερού"),
                    ("gas_hw_consumption_bill", "Φυσικο αέριο ζεστού νερού"),
                    ("damages", "Ζημιές"),
                    ("annual_servicing", "Ετήσια συντήρηση"),
                    ("owners_only", "Έξοδα μόνο ιδιοκτητών"),
                    ("fund_increase", "Αύξηση αποθεματικού"),
                    ("other", "Λοιπά"),
                ],
                max_length=64,
            ),
        ),
    ]
