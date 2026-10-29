import { useCallback, useEffect, useRef, useState } from 'react';
import { History, Loader2, RefreshCw } from 'lucide-react';
import { fetchAuditEvents, type AuditEvent } from '../services/auditService';

const formatDate = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export const AdminAuditTab = ({ refreshVersion = 0 }: { refreshVersion?: number }) => {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchAuditEvents(100);
      if (currentRequest === requestId.current) {
        setEvents(page.events);
        setNextCursor(page.nextCursor);
      }
    } catch (failure) {
      if (currentRequest === requestId.current) {
        setError(failure instanceof Error ? failure.message : 'Audit history could not be loaded.');
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, []);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await fetchAuditEvents(100, nextCursor);
      setEvents(current => [...current, ...page.events.filter(event => !current.some(existing => existing.id === event.id))]);
      setNextCursor(page.nextCursor);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'More audit events could not be loaded.');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => { void load(); }, [load, refreshVersion]);

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><History className="h-4 w-4 text-violet-400" />Audit trail</h3>
          <p className="mt-1 text-xs text-gray-500">Append-only generation, share and media events. Administrators see all users.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-700 px-3 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">{error}</p>
      ) : loading ? (
        <div role="status" className="flex items-center justify-center gap-2 p-8 text-xs text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading audit events…</div>
      ) : events.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-700 p-8 text-center text-xs text-gray-500">No audit events recorded yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-900/60 text-gray-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Time</th>
                <th className="px-3 py-2 font-semibold">User</th>
                <th className="px-3 py-2 font-semibold">Action</th>
                <th className="px-3 py-2 font-semibold">Target</th>
                <th className="px-3 py-2 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {events.map(event => (
                <tr key={event.id} className="text-gray-300">
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500">{formatDate(event.created_at)}</td>
                  <td className="max-w-[10rem] truncate px-3 py-2 font-mono text-[10px] text-gray-500">{event.user_id || 'system'}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-violet-200">{event.action}</td>
                  <td className="max-w-[12rem] truncate px-3 py-2 text-gray-400">{event.target_type || '—'}{event.target_id ? ` · ${event.target_id}` : ''}</td>
                  <td className="max-w-[18rem] truncate px-3 py-2 text-gray-500">{JSON.stringify(event.metadata || {})}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {nextCursor && !loading && (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-gray-700 px-3 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
        >
          {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />}
          Load older events
        </button>
      )}
    </div>
  );
};
