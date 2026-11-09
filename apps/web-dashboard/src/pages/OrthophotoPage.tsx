/**
 * OrthophotoPage: upload the monthly drone ECW. The server converts it to a
 * COG and, once ready, it replaces the previous month on every map.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ORTHOPHOTO_CHANGE_EVENT,
  deleteOrthophoto,
  fetchOrthophotos,
  uploadOrthophoto,
} from '@/api/orthophoto.api';

const QUERY_KEY = ['orthophotos'];
const MAX_BYTES = 2 * 1024 * 1024 * 1024;

export function OrthophotoPage() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const { data: items = [], isError } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchOrthophotos,
    refetchInterval: (q) => (q.state.data?.some((o) => o.status === 'processing') ? 5000 : false),
  });
  const ready = items.find((o) => o.status === 'ready');
  const processing = items.find((o) => o.status === 'processing');
  const failed = items.find((o) => o.status === 'failed');

  // A conversion finishing changes what every open map should draw.
  const readyId = ready?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: fire when the published id changes.
  useEffect(() => {
    window.dispatchEvent(new Event(ORTHOPHOTO_CHANGE_EVENT));
  }, [readyId]);

  const upload = useMutation({
    mutationFn: (file: File) => uploadOrthophoto(file, setProgress),
    onSettled: () => {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
      void client.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
  const remove = useMutation({
    mutationFn: deleteOrthophoto,
    onSettled: () => void client.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const onPick = (file: File | undefined) => {
    setLocalError(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.ecw')) {
      setLocalError(t('orthophoto.errorType'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setLocalError(t('orthophoto.errorSize'));
      return;
    }
    upload.mutate(file);
  };

  const busy = progress !== null || Boolean(processing);
  const cardClass =
    'rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-graydark-300';

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('orthophoto.title')}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-graydark-600">
          {t('orthophoto.subtitle')}
        </p>
      </div>

      <section className={cardClass}>
        <input
          ref={inputRef}
          type="file"
          accept=".ecw"
          disabled={busy}
          data-testid="orthophoto-file"
          aria-label={t('orthophoto.choose')}
          onChange={(e) => onPick(e.target.files?.[0])}
          className="block w-full cursor-pointer text-sm text-gray-700 file:me-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand-500 file:px-4 file:py-2 file:font-semibold file:text-white disabled:opacity-50 dark:text-graydark-700"
        />
        {progress !== null && (
          <p className="mt-3 text-sm text-gray-600 dark:text-graydark-700">
            {t('orthophoto.uploading', { percent: Math.round(progress * 100) })}
          </p>
        )}
        {processing && (
          <output className="mt-3 block text-sm text-brand-600 dark:text-brand-300">
            {t('orthophoto.processing', { name: processing.originalName })}
          </output>
        )}
        {(localError || upload.isError || isError) && (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {localError ?? t('orthophoto.errorRequest')}
          </p>
        )}
        {failed && !processing && (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {t('orthophoto.failed', { name: failed.originalName })}
            {failed.error ? ` (${failed.error})` : ''}
          </p>
        )}
      </section>

      <section className={cardClass}>
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">
          {t('orthophoto.current')}
        </h2>
        {ready ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600 dark:text-graydark-700">
            <span className="min-w-0 break-all">
              {ready.originalName}
              {ready.readyAt
                ? ` · ${new Date(ready.readyAt).toLocaleDateString(i18n.language)}`
                : ''}
            </span>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
              className="cursor-pointer rounded-lg border border-red-300 px-3 py-1.5 font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-500/10"
            >
              {t('orthophoto.remove')}
            </button>
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-500 dark:text-graydark-600">
            {t('orthophoto.none')}
          </p>
        )}
      </section>
    </div>
  );
}
