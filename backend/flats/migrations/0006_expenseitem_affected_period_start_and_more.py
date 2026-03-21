from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("flats", "0005_heatedwatermeasurementinput_current_reading_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="expenseitem",
            name="affected_period_end",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="expenseitem",
            name="affected_period_start",
            field=models.DateField(blank=True, null=True),
        ),
    ]
