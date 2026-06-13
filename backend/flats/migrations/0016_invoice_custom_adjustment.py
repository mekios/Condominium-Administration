from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("flats", "0015_expense_fund_increase_category"),
    ]

    operations = [
        migrations.AddField(
            model_name="invoice",
            name="custom_adjustment",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=14),
        ),
        migrations.AddField(
            model_name="invoice",
            name="custom_adjustment_note",
            field=models.TextField(blank=True),
        ),
    ]
