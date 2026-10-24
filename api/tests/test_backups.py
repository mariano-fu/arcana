"""Backups and restores (T4.3, ops/backups.py).

Tests marked `pg_tools` run pg_dump, pg_restore and psql against the test database; they are
skipped where the Postgres client isn't installed (CI's runner has it).
"""

import datetime as dt
import io
import shutil
import subprocess
from collections.abc import Iterator
from pathlib import Path

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test import override_settings

from ops import backups
from ops.backups import BackupError, backup_name, create_backup, pending_migrations, prune
from sync.models import Client, current_epoch, rotate_epoch
from tests import factories

pg_tools = pytest.mark.skipif(
    not all(shutil.which(tool) for tool in ("pg_dump", "pg_restore", "psql")),
    reason="needs the Postgres client tools (pg_dump, pg_restore, psql)",
)

NOW = dt.datetime(2026, 10, 24, 9, 0, tzinfo=dt.UTC)


@pytest.fixture
def backup_dir(tmp_path: Path) -> Iterator[Path]:
    with override_settings(BACKUP_DIR=str(tmp_path)):
        yield tmp_path


@pytest.fixture
def test_database() -> None:
    # These tests drop and recreate the schema of whatever database Django points at.
    assert connection.settings_dict["NAME"].startswith("test_")


def names(directory: Path) -> set[str]:
    return {path.name for path in directory.iterdir()}


def make_dumps(directory: Path, ages_in_days: list[int]) -> list[str]:
    created = []
    for age in ages_in_days:
        name = backup_name("nightly", NOW - dt.timedelta(days=age))
        (directory / name).write_bytes(b"")
        created.append(name)
    return created


# Pruning: names and dates only, no database.


def test_prune_deletes_dumps_older_than_the_retention(backup_dir: Path) -> None:
    kept = make_dumps(backup_dir, [0, 10, 30])
    old = make_dumps(backup_dir, [31, 45])

    removed = prune(now=NOW, retention_days=30, keep_min=0)

    assert {path.name for path in removed} == set(old)
    assert names(backup_dir) == set(kept)


def test_prune_always_keeps_the_newest_dumps_however_old(backup_dir: Path) -> None:
    # Backups stopped working two months ago: the last good ones must survive.
    newest = make_dumps(backup_dir, [60, 61, 62])
    oldest = make_dumps(backup_dir, [63, 64])

    prune(now=NOW, retention_days=30, keep_min=3)

    assert names(backup_dir) == set(newest)
    assert not set(oldest) & names(backup_dir)


def test_prune_counts_every_reason_and_ignores_other_files(backup_dir: Path) -> None:
    old = NOW - dt.timedelta(days=40)
    for reason in backups.REASONS:
        (backup_dir / backup_name(reason, old)).write_bytes(b"")
    others = [
        "notes.txt",
        "arcana-20200101T000000Z-manual.dump",
        f"{backup_name('nightly', old)}.partial",
        "lost+found",
    ]
    for other in others:
        (backup_dir / other).write_bytes(b"")

    prune(now=NOW, retention_days=30, keep_min=0)

    assert names(backup_dir) == set(others)


def test_prune_uses_the_settings_by_default(backup_dir: Path) -> None:
    make_dumps(backup_dir, [40, 50])

    with override_settings(BACKUP_RETENTION_DAYS=30, BACKUP_KEEP_MIN=1):
        prune(now=NOW)

    assert names(backup_dir) == {backup_name("nightly", NOW - dt.timedelta(days=40))}


def test_backup_names_sort_by_time_in_utc() -> None:
    costa_rica = dt.timezone(dt.timedelta(hours=-6))
    at_three = dt.datetime(2026, 10, 24, 3, 0, tzinfo=costa_rica)

    assert backup_name("nightly", at_three) == "arcana-20261024T090000Z-nightly.dump"
    assert backups.backup_time(Path("arcana-20261024T090000Z-nightly.dump")) == NOW


def test_backup_fails_without_the_backup_directory(tmp_path: Path) -> None:
    with (
        override_settings(BACKUP_DIR=str(tmp_path / "missing")),
        pytest.raises(BackupError, match="does not exist"),
    ):
        create_backup("nightly")


# migrate_with_backup: pending migrations are dumped first (tasks.md T4.3, note 2).


@pytest.fixture
def horoscopes_one_behind(transactional_db: None) -> Iterator[None]:
    """The test database with the last horoscopes migration unapplied; restored afterwards."""
    call_command("migrate", "horoscopes", "0001", verbosity=0)
    try:
        yield
    finally:
        call_command("migrate", verbosity=0)


def test_pending_migrations_reports_unapplied_ones(horoscopes_one_behind: None) -> None:
    assert pending_migrations() is True
    call_command("migrate", verbosity=0)
    assert pending_migrations() is False


def test_pending_migrations_is_none_for_a_database_never_migrated(
    db: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(connection.introspection, "table_names", lambda *a, **k: [])
    assert pending_migrations() is None


def test_migrate_with_backup_dumps_before_migrating(
    horoscopes_one_behind: None, monkeypatch: pytest.MonkeyPatch, backup_dir: Path
) -> None:
    calls: list[tuple[str, bool | None]] = []

    def fake_backup(reason: str) -> Path:
        calls.append((reason, pending_migrations()))
        return backup_dir / "dump"

    monkeypatch.setattr("ops.management.commands.migrate_with_backup.create_backup", fake_backup)

    call_command("migrate_with_backup", stdout=io.StringIO())

    # Dumped once, while the migration was still pending; migrated afterwards.
    assert calls == [("pre-migrate", True)]
    assert pending_migrations() is False


def test_migrate_with_backup_does_not_migrate_if_the_dump_fails(
    horoscopes_one_behind: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    def failing_backup(reason: str) -> Path:
        raise BackupError("disk full")

    monkeypatch.setattr("ops.management.commands.migrate_with_backup.create_backup", failing_backup)

    with pytest.raises(CommandError, match="not migrating: disk full"):
        call_command("migrate_with_backup", stdout=io.StringIO())

    assert pending_migrations() is True


def test_migrate_with_backup_skips_the_dump_with_nothing_pending(
    db: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    def unexpected_backup(reason: str) -> Path:
        raise AssertionError("no backup expected")

    monkeypatch.setattr(
        "ops.management.commands.migrate_with_backup.create_backup", unexpected_backup
    )

    call_command("migrate_with_backup", stdout=io.StringIO())


@pg_tools
def test_migrate_with_backup_writes_a_real_pre_migrate_dump(
    horoscopes_one_behind: None, backup_dir: Path, test_database: None
) -> None:
    call_command("migrate_with_backup", stdout=io.StringIO())

    [dump] = backup_dir.iterdir()
    assert dump.name.endswith("-pre-migrate.dump")
    assert pending_migrations() is False


# Real dumps and restores.


@pg_tools
def test_backup_writes_a_dump_pg_restore_can_read(
    transactional_db: None, backup_dir: Path, test_database: None
) -> None:
    out = io.StringIO()
    call_command("backup_db", stdout=out)

    [dump] = backup_dir.iterdir()
    assert backups.backup_time(dump) is not None
    assert dump.name.endswith("-nightly.dump")
    assert str(dump) in out.getvalue()
    listing = subprocess.run(  # noqa: S603
        [shutil.which("pg_restore") or "pg_restore", "--list", str(dump)],
        capture_output=True,
        check=True,
        text=True,
    ).stdout
    assert "TABLE DATA public client" in listing


@pg_tools
def test_backup_keeps_the_password_off_the_command_line(
    transactional_db: None, backup_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[tuple[list[str], dict[str, str]]] = []
    real_run = subprocess.run

    def spy(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[bytes]:
        env = kwargs.get("env")
        assert isinstance(env, dict)
        seen.append((args, env))
        return real_run(args, **kwargs)  # type: ignore[call-overload,no-any-return]

    monkeypatch.setattr(subprocess, "run", spy)
    password = connection.settings_dict["PASSWORD"]

    create_backup("nightly")

    assert seen
    for args, env in seen:
        assert env["PGPASSWORD"] == password
        # Not as an argument, nor inside a connection string (the password may be a word
        # that also appears in a file name, as in CI).
        assert password not in args
        assert not any(f":{password}@" in arg for arg in args)


@pg_tools
def test_a_failed_dump_leaves_no_file(
    transactional_db: None, backup_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken_env() -> dict[str, str]:
        return {"PGHOST": "/nonexistent", "PATH": "/usr/bin:/bin"}

    monkeypatch.setattr(backups, "_pg_env", broken_env)

    with pytest.raises(BackupError, match="pg_dump failed"):
        create_backup("nightly")

    assert names(backup_dir) == set()


@pg_tools
def test_restore_brings_back_the_dumped_data_and_changes_the_epoch(
    transactional_db: None, backup_dir: Path, test_database: None
) -> None:
    kept = factories.ClientFactory(name="Before the backup")
    dumped_epoch = current_epoch()
    dump = create_backup("nightly", now=NOW)
    lost = factories.ClientFactory(name="After the backup")
    epoch_before_restore = rotate_epoch()

    out = io.StringIO()
    call_command("restore_db", dump.name, "--yes", stdout=out)

    assert set(Client.objects.values_list("id", flat=True)) == {kept.id}
    assert not Client.objects.filter(id=lost.id).exists()
    # The restored row carries the dumped epoch; the restore itself rotates it (T4.3, note 1).
    restored_epoch = current_epoch()
    assert restored_epoch not in (dumped_epoch, epoch_before_restore)
    assert f"{epoch_before_restore} → {restored_epoch}" in out.getvalue()
    # The data the restore replaced was dumped first.
    [pre_restore] = [path for path in backup_dir.iterdir() if path != dump]
    assert pre_restore.name.endswith("-pre-restore.dump")
    assert pending_migrations() is False


@pg_tools
def test_restore_of_an_older_schema_drops_newer_tables_then_migrates(
    horoscopes_one_behind: None, backup_dir: Path, test_database: None
) -> None:
    dump = create_backup("nightly", now=NOW)
    call_command("migrate", verbosity=0)
    with connection.cursor() as cursor:
        cursor.execute("CREATE TABLE left_behind (id int)")

    call_command("restore_db", str(dump), "--yes", stdout=io.StringIO())

    assert "left_behind" not in connection.introspection.table_names()
    assert pending_migrations() is False


@pg_tools
def test_a_broken_dump_changes_nothing(
    transactional_db: None, backup_dir: Path, test_database: None
) -> None:
    client = factories.ClientFactory()
    epoch = current_epoch()
    broken = backup_dir / backup_name("nightly", NOW)
    broken.write_bytes(b"not a dump")

    with pytest.raises(CommandError, match="Restore failed"):
        call_command("restore_db", broken.name, "--yes", stdout=io.StringIO())

    assert Client.objects.filter(id=client.id).exists()
    assert current_epoch() == epoch
    assert names(backup_dir) == {broken.name}


def test_restore_needs_confirmation(db: None, backup_dir: Path) -> None:
    (backup_dir / "some.dump").write_bytes(b"")

    with pytest.raises(CommandError, match="pass --yes"):
        call_command("restore_db", "some.dump")


def test_restore_refuses_a_missing_file(db: None, backup_dir: Path) -> None:
    with pytest.raises(CommandError, match="No backup at"):
        call_command("restore_db", "missing.dump", "--yes")
