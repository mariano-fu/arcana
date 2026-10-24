"""Database backups and restores with the Postgres client tools (specs/plan.md, "Deploy").

Dumps are `pg_dump` custom-format files in `BACKUP_DIR`, named
`arcana-<UTC timestamp>-<reason>.dump`. Only files with that name are ever pruned.
"""

import datetime as dt
import io
import os
import re
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Literal

from django.conf import settings
from django.core.management import call_command
from django.db import DEFAULT_DB_ALIAS, connections
from django.db.migrations.executor import MigrationExecutor

from sync.models import current_epoch

Reason = Literal["nightly", "pre-migrate", "pre-restore"]
REASONS: tuple[Reason, ...] = ("nightly", "pre-migrate", "pre-restore")

STAMP_FORMAT = "%Y%m%dT%H%M%SZ"
BACKUP_NAME = re.compile(r"^arcana-(?P<stamp>\d{8}T\d{6}Z)-(?P<reason>[a-z-]+)\.dump$")


class BackupError(Exception):
    """A backup or restore step failed; the message says which and why."""


def backup_dir() -> Path:
    return Path(settings.BACKUP_DIR)


def backup_name(reason: Reason, at: dt.datetime) -> str:
    return f"arcana-{at.astimezone(dt.UTC).strftime(STAMP_FORMAT)}-{reason}.dump"


def backup_time(path: Path) -> dt.datetime | None:
    """When a backup was taken, from its name; None for any file this module didn't name."""
    match = BACKUP_NAME.match(path.name)
    if match is None or match["reason"] not in REASONS:
        return None
    return dt.datetime.strptime(match["stamp"], STAMP_FORMAT).replace(tzinfo=dt.UTC)


def _tool(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        raise BackupError(f"{name} not found on PATH (the cron image has the Postgres client).")
    return path


def _pg_env() -> dict[str, str]:
    """The environment for the Postgres tools: the default database's connection settings.

    The password goes in PGPASSWORD, never on a command line other processes can read.
    """
    db = connections[DEFAULT_DB_ALIAS].settings_dict
    pg = {
        "PGDATABASE": db["NAME"],
        "PGUSER": db["USER"],
        "PGPASSWORD": db["PASSWORD"],
        "PGHOST": db["HOST"],
        "PGPORT": str(db["PORT"]),
    }
    return {**os.environ, **{key: str(value) for key, value in pg.items() if value}}


def _run(args: list[str]) -> None:
    # Fixed arguments built here, never user input; the executables are resolved with _tool.
    result = subprocess.run(  # noqa: S603
        args, env=_pg_env(), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
    )
    if result.returncode != 0:
        detail = result.stderr.decode(errors="replace").strip()
        raise BackupError(f"{Path(args[0]).name} failed ({result.returncode}): {detail}")


def check_readable(path: Path) -> None:
    """Fail unless `path` is a dump pg_restore can read."""
    _run([_tool("pg_restore"), "--list", str(path)])


def create_backup(reason: Reason, now: dt.datetime | None = None) -> Path:
    """Dump the database to a new file in BACKUP_DIR, check it, then prune old dumps.

    The dump is written to a `.partial` file and renamed only once pg_restore can read it,
    so a dump that failed halfway never looks like a backup.
    """
    now = now or dt.datetime.now(dt.UTC)
    directory = backup_dir()
    if not directory.is_dir():
        raise BackupError(f"Backup directory {directory} does not exist.")
    target = directory / backup_name(reason, now)
    if target.exists():
        raise BackupError(f"{target} already exists.")
    partial = target.with_name(f"{target.name}.partial")
    try:
        _run(
            [
                _tool("pg_dump"),
                "--format=custom",
                "--no-owner",
                "--no-privileges",
                f"--file={partial}",
            ]
        )
        check_readable(partial)
        partial.rename(target)
    finally:
        partial.unlink(missing_ok=True)
    prune(now=now)
    return target


def prune(
    now: dt.datetime | None = None,
    retention_days: int | None = None,
    keep_min: int | None = None,
) -> list[Path]:
    """Delete dumps older than the retention, but always keep the newest `keep_min`.

    If backups stop working, the last good ones stay however old they get. Files this
    module didn't name (anything else in the directory) are never touched.
    """
    now = now or dt.datetime.now(dt.UTC)
    retention = dt.timedelta(
        days=settings.BACKUP_RETENTION_DAYS if retention_days is None else retention_days
    )
    keep = settings.BACKUP_KEEP_MIN if keep_min is None else keep_min
    dated = [(when, path) for path in backup_dir().iterdir() if (when := backup_time(path))]
    dated.sort(reverse=True)
    removed = [path for when, path in dated[keep:] if when < now - retention]
    for path in removed:
        path.unlink()
    return removed


def pending_migrations() -> bool | None:
    """Whether migrations are waiting to be applied; None for a database never migrated."""
    connection = connections[DEFAULT_DB_ALIAS]
    if "django_migrations" not in connection.introspection.table_names():
        return None
    executor = MigrationExecutor(connection)
    return bool(executor.migration_plan(executor.loader.graph.leaf_nodes()))


def resolve_backup(name: str) -> Path:
    """A backup given by file name (looked up in BACKUP_DIR) or by path."""
    path = Path(name)
    if not path.is_absolute():
        path = backup_dir() / path
    if not path.is_file():
        raise BackupError(f"No backup at {path}.")
    return path


def restore_backup(path: Path) -> tuple[uuid.UUID, uuid.UUID]:
    """Replace the whole database with a dump; returns the epochs before and after.

    In order: check the dump, dump the current database (`pre-restore`), replace the
    `public` schema with the dump's in one transaction (nothing changes if any statement
    fails), migrate (an older backup's schema catches up with the code), and rotate the
    sync epoch, so devices re-push and pull from 0 instead of trusting cursors into the
    database as it was (specs/plan.md, "Epoch").
    """
    check_readable(path)
    before = current_epoch()
    create_backup("pre-restore")
    # No open connection may hold a lock on the schema being dropped.
    connections.close_all()

    # The dump is rendered to SQL first: psql reading a stream that pg_restore broke off
    # halfway would see a normal end of input and commit a partial restore.
    sql = backup_dir() / f".{path.name}.restore.sql"
    try:
        _run([_tool("pg_restore"), "--no-owner", "--no-privileges", f"--file={sql}", str(path)])
        # -1 wraps every -c and -f in one transaction; dropping the schema first means an
        # older dump leaves no table from a newer migration behind.
        _run(
            [
                _tool("psql"),
                "--no-psqlrc",
                "--quiet",
                "--single-transaction",
                "--set=ON_ERROR_STOP=1",
                "--command=DROP SCHEMA public CASCADE",
                "--command=CREATE SCHEMA public",
                f"--file={sql}",
            ]
        )
    finally:
        sql.unlink(missing_ok=True)

    call_command("migrate", interactive=False, verbosity=0)
    # The command prints the new epoch; restore_db reports both epochs itself.
    call_command("rotate_sync_epoch", stdout=io.StringIO())
    return before, current_epoch()
