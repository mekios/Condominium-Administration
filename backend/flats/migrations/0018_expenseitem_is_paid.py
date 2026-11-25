from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("flats", "0017_building_measurement_input"),
    ]

    operations = [
        migrations.AddField(
            model_name="expenseitem",
            name="is_paid",
            field=models.BooleanField(default=True),
        ),
    ]
