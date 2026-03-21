from django.db import migrations, models


def forward_update_categories(apps, schema_editor):
    ExpenseItem = apps.get_model("flats", "ExpenseItem")
    ExpenseItem.objects.filter(expense_category="water_consumption_bill").update(
        expense_category="water_hw_consumption_bill"
    )


def backward_update_categories(apps, schema_editor):
    ExpenseItem = apps.get_model("flats", "ExpenseItem")
    ExpenseItem.objects.filter(expense_category="water_hw_consumption_bill").update(
        expense_category="water_consumption_bill"
    )
    ExpenseItem.objects.filter(expense_category="gas_hw_consumption_bill").update(expense_category="other")


class Migration(migrations.Migration):
    dependencies = [
        ("flats", "0007_measurement_date_replace_month"),
    ]

    operations = [
        migrations.RunPython(forward_update_categories, backward_update_categories),
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
                    ("other", "Λοιπά"),
                ],
                max_length=64,
            ),
        ),
    ]
