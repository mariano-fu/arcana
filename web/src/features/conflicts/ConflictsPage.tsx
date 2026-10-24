import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { db, getDeviceId } from '../../db';
import { cardName } from '../../seed/cards';
import { formatDate, formatDay } from '../clients/format';
import { deleteSession } from '../sessions/actions';
import DeleteSessionDialog from '../sessions/DeleteSessionDialog';
import { formatDateTime } from '../sessions/format';
import { cardByKey } from '../spreads/cardSearch';
import { combinedText, resolveConflict, restoreClient, type Resolution } from './actions';
import { linkTo, type ConflictContext, type ConflictGroup } from './conflicts';
import { useReview } from './hooks';
import type { OrphanSession } from './orphans';

const BUTTON = 'min-h-11 rounded-lg border border-stone-300 bg-white px-4 text-base';
const PRIMARY =
  'min-h-11 rounded-lg border border-stone-900 bg-stone-900 px-4 text-base text-stone-50';

/** "Conflictos": texts edited on two devices, and sessions of a deleted ficha (T3.7). */
export default function ConflictsPage() {
  const { t } = useTranslation();
  const review = useReview();
  const deviceId = useDeviceId();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('conflicts.title')}</h1>
      <p className="text-base text-stone-700">{t('conflicts.intro')}</p>
      {review && review.groups.length === 0 && review.orphans.length === 0 && (
        <p className="text-stone-600">{t('conflicts.empty')}</p>
      )}
      {review?.groups.map((group) => (
        <ConflictCard key={group.key} group={group} deviceId={deviceId} />
      ))}
      {review?.orphans.map((orphan) => (
        <OrphanCard key={orphan.session.id} orphan={orphan} />
      ))}
    </div>
  );
}

function useDeviceId(): string | null {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  useEffect(() => {
    void getDeviceId(db).then(setDeviceId);
  }, []);
  return deviceId;
}

function whereLabel(group: ConflictGroup, t: TFunction): string {
  const context: ConflictContext = group.context;
  const name = (value: string | null) => value ?? t('conflicts.where.noName');
  switch (context.kind) {
    case 'client':
      return t('conflicts.where.client', { name: name(context.clientName) });
    case 'session':
      return t(
        group.field === 'follow_up_note'
          ? 'conflicts.where.session_follow_up_note'
          : 'conflicts.where.session_notes',
        {
          name: name(context.clientName),
          date: context.startedAt ? formatDay(context.startedAt) : t('conflicts.where.noDate'),
        },
      );
    case 'payment':
      return t('conflicts.where.payment', {
        name: name(context.clientName),
        date: context.paidAt ? formatDate(context.paidAt) : t('conflicts.where.noDate'),
      });
    case 'card_draw':
    case 'card_note': {
      const card = context.cardId ? cardByKey(context.cardId) : undefined;
      const label = card ? cardName(card, t) : (context.cardId ?? '');
      return t(
        context.kind === 'card_draw' ? 'conflicts.where.card_draw' : 'conflicts.where.card_note',
        { card: label },
      );
    }
    case 'other':
      return t('conflicts.where.other', { table: group.table, field: group.field });
  }
}

function Text({ text }: { text: string | null }) {
  const { t } = useTranslation();
  return text ? (
    <p className="rounded-lg bg-stone-100 p-3 text-base whitespace-pre-wrap">{text}</p>
  ) : (
    <p className="rounded-lg bg-stone-100 p-3 text-base text-stone-500">
      {t('conflicts.emptyText')}
    </p>
  );
}

function ConflictCard({ group, deviceId }: { group: ConflictGroup; deviceId: string | null }) {
  const { t } = useTranslation();
  const [combining, setCombining] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const link = linkTo(group.context);
  const titleId = `conflict-${group.key}`;
  const resolve = (resolution: Resolution) => {
    void resolveConflict(
      db,
      {
        table: group.table,
        recordId: group.recordId,
        field: group.field,
        conflictIds: group.conflicts.map((conflict) => conflict.id),
      },
      resolution,
    );
  };

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={titleId} className="text-base font-semibold">
          {whereLabel(group, t)}
        </h2>
        {link && group.state === 'live' && (
          <Link to={link} className="text-sm text-stone-600 underline">
            {t('conflicts.where.open')}
          </Link>
        )}
      </div>

      {group.state === 'missing' && (
        <p className="text-sm text-stone-600">{t('conflicts.missing')}</p>
      )}
      {group.state === 'deleted' && (
        <p className="text-sm text-stone-600">{t('conflicts.deleted.body')}</p>
      )}

      {group.state === 'live' && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-stone-700">{t('conflicts.current')}</h3>
          <Text text={group.current} />
        </div>
      )}

      {group.conflicts.map((conflict) => (
        <div key={conflict.id} className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-stone-700">
            {t(
              conflict.losing_device_id === deviceId
                ? 'conflicts.fromThisDevice'
                : 'conflicts.fromOtherDevice',
              { date: formatDateTime(conflict.created_at) },
            )}
          </h3>
          <Text text={conflict.losing_value} />
          {group.state === 'live' && group.freeText && combining === null && (
            <button
              type="button"
              className={`${BUTTON} self-start`}
              onClick={() => {
                resolve({ kind: 'write', text: conflict.losing_value ?? '' });
              }}
            >
              {t('conflicts.use')}
            </button>
          )}
          {group.state === 'deleted' && conflict.losing_value && (
            <button
              type="button"
              className={`${BUTTON} self-start`}
              onClick={() => {
                void navigator.clipboard.writeText(conflict.losing_value ?? '').then(() => {
                  setCopied(true);
                });
              }}
            >
              {copied ? t('conflicts.deleted.copied') : t('conflicts.deleted.copy')}
            </button>
          )}
        </div>
      ))}

      {group.state === 'live' && !group.freeText && (
        <p className="text-sm text-stone-600">{t('conflicts.structured')}</p>
      )}

      {group.state === 'live' && combining !== null && (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-stone-700">{t('conflicts.combined')}</span>
          <textarea
            value={combining}
            rows={6}
            onChange={(event) => {
              setCombining(event.target.value);
            }}
            className="rounded-lg border border-stone-300 p-3 text-base"
          />
        </label>
      )}

      <div className="flex flex-wrap gap-2">
        {group.state === 'live' && combining === null && (
          <>
            <button
              type="button"
              className={PRIMARY}
              onClick={() => {
                resolve({ kind: 'keep' });
              }}
            >
              {t('conflicts.keep')}
            </button>
            {group.freeText && (
              <button
                type="button"
                className={BUTTON}
                onClick={() => {
                  setCombining(
                    combinedText(
                      group.current ?? '',
                      group.conflicts.map((conflict) => conflict.losing_value),
                    ),
                  );
                }}
              >
                {t('conflicts.combine')}
              </button>
            )}
          </>
        )}
        {group.state === 'live' && combining !== null && (
          <>
            <button
              type="button"
              className={PRIMARY}
              onClick={() => {
                resolve({ kind: 'write', text: combining });
              }}
            >
              {t('conflicts.saveCombined')}
            </button>
            <button
              type="button"
              className={BUTTON}
              onClick={() => {
                setCombining(null);
              }}
            >
              {t('conflicts.cancel')}
            </button>
          </>
        )}
        {group.state === 'deleted' && (
          <button
            type="button"
            className={BUTTON}
            onClick={() => {
              resolve({ kind: 'discard' });
            }}
          >
            {t('conflicts.deleted.discard')}
          </button>
        )}
      </div>
    </section>
  );
}

function OrphanCard({ orphan }: { orphan: OrphanSession }) {
  const { t } = useTranslation();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const titleId = `orphan-${orphan.session.id}`;
  const contents = [
    t('conflicts.orphan.readings', { count: orphan.readings }),
    t('conflicts.orphan.payments', { count: orphan.payments }),
  ].join(' · ');

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4"
    >
      <h2 id={titleId} className="text-base font-semibold">
        {t('conflicts.orphan.title')}
      </h2>
      <p className="text-base">
        {t('conflicts.orphan.body', {
          name: orphan.client.name,
          date: formatDay(orphan.session.started_at),
        })}
      </p>
      <p className="text-sm text-stone-600">{contents}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={PRIMARY}
          onClick={() => {
            void restoreClient(db, orphan.client.id);
          }}
        >
          {t('conflicts.orphan.restore')}
        </button>
        <button
          type="button"
          className={`${BUTTON} text-red-700`}
          onClick={() => {
            setConfirmingDelete(true);
          }}
        >
          {t('conflicts.orphan.delete')}
        </button>
      </div>
      {confirmingDelete && (
        <DeleteSessionDialog
          sessionId={orphan.session.id}
          onDelete={() => {
            void deleteSession(db, orphan.session.id);
          }}
          onCancel={() => {
            setConfirmingDelete(false);
          }}
        />
      )}
    </section>
  );
}
