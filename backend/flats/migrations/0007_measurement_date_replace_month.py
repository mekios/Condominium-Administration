from datetime import date

from django.db import migrations, models


def backfill_measurement_dates(apps, schema_editor):
    HeatingMeasurementInput = apps.get_model("flats", "HeatingMeasurementInput")
    HeatedWaterMeasurementInput = apps.get_model("flats", "HeatedWaterMeasurementInput")

    for row in HeatingMeasurementInput.objects.all().only("id", "month"):
        year_str, month_str = row.month.split("-")
        row.measurement_date = date(int(year_str), int(month_str), 1)
        row.save(update_fields=["measurement_date"])

    for row in HeatedWaterMeasurementInput.objects.all().only("id", "month"):
        year_str, month_str = row.month.split("-")
        row.measurement_date = date(int(year_str), int(month_str), 1)
        row.save(update_fields=["measurement_date"])


class Migration(migrations.Migration):
    dependencies = [
        ("flats", "0006_expenseitem_affected_period_start_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="heatingmeasurementinput",
            name="measurement_date",
            field=models.DateField(null=True),
        ),
        migrations.AddField(
            model_name="heatedwatermeasurementinput",
            name="measurement_date",
            field=models.DateField(null=True),
        ),
        migrations.RunPython(backfill_measurement_dates, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="heatingmeasurementinput",
            name="measurement_date",
            field=models.DateField(),
        ),
        migrations.AlterField(
            model_name="heatedwatermeasurementinput",
            name="measurement_date",
            field=models.DateField(),
        ),
        migrations.AlterUniqueTogether(
            name="heatingmeasurementinput",
            unique_together={("apartment", "measurement_date")},
        ),
        migrations.AlterUniqueTogether(
            name="heatedwatermeasurementinput",
            unique_together={("apartment", "measurement_date")},
        ),
        migrations.RemoveField(
            model_name="heatingmeasurementinput",
            name="month",
        ),
        migrations.RemoveField(
            model_name="heatedwatermeasurementinput",
            name="month",
        ),
    ]
