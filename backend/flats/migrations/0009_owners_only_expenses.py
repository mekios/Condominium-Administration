from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("flats", "0008_expenseitem_category_updates"),
    ]

    operations = [
        migrations.AddField(
            model_name="invoice",
            name="owners_only_total",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=14),
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
                    ("gas_heating_bill", "Φυσικό αερίου θέρμανσης"),
                    ("water_hw_consumption_bill", "Κατανάλωση ζεστού νερού"),
                    ("gas_hw_consumption_bill", "Φυσικο αέριο ζεστού νερού"),
                    ("damages", "Ζημιές"),
                    ("annual_servicing", "Ετήσια συντήρηση"),
                    ("owners_only", "Έξοδα μόνο ιδιοκτητών"),
                    ("other", "Λοιπά"),
                ],
                max_length=64,
            ),
        ),
    ]
