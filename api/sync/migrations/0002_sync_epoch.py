import uuid

from django.apps.registry import Apps
from django.db import migrations, models
from django.db.backends.base.schema import BaseDatabaseSchemaEditor


def create_epoch(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    apps.get_model("sync", "SyncEpoch").objects.create(pk=1, epoch=uuid.uuid4())


class Migration(migrations.Migration):

    dependencies = [
        ("sync", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="SyncEpoch",
            fields=[
                (
                    "id",
                    models.PositiveSmallIntegerField(
                        default=1, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("epoch", models.UUIDField(default=uuid.uuid4)),
            ],
            options={
                "db_table": "sync_epoch",
            },
        ),
        # One random id per database, created with it.
        migrations.RunPython(create_epoch, migrations.RunPython.noop),
    ]
