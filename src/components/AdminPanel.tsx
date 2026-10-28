import { H3_MAX_MODE_OPTIONS } from '../lib/video/h3Max';
import { H3_MAX_OUTPUT_RATES } from '../lib/video/h3MaxPricing';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Loader2, Image as ImageIcon, DollarSign, BarChart3, RefreshCw, ShieldCheck, Plus, Trash2, Mail, Settings, Video, Wand2, ExternalLink, ChevronDown } from 'lucide-react';
import { AdminUserSummary, VideoQuality, getEvoLinkVideoPricing, isSeedance25PromoActive } from '../types';
import {
  getAdminUsageSummary,
  getAuthorizedEmails,
  addAuthorizedEmail,
  removeAuthorizedEmail,
  resetUsageLogs,
  getProviderUsageSummary,
  AuthorizedEmail,
  ProviderUsageSummary,
} from '../services/authService';
import { TextModelSettings } from './TextModelSettings';
import { AdminModelUsage, AdminProviderUsage } from './AdminModelUsage';
import { AdminUsageFilter } from './AdminUsageFilter';
import { AdminUsagePeriod, resolveAdminUsageRange } from '../lib/admin/adminUsageRange';

type AdminTab = 'usage' | 'access' | 'settings';

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onViewUserGallery: (user: AdminUserSummary) => void;
  onBillingReconciled?: () => void | Promise<void>;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ isOpen, onClose, onViewUserGallery, onBillingReconciled }) => {
  const billingReconciledRef = useRef(onBillingReconciled);
  billingReconciledRef.current = onBillingReconciled;
  const [activeTab, setActiveTab] = useState<AdminTab>('usage');
  const [isLoading, setIsLoading] = useState(true);
  const [userSummaries, setUserSummaries] = useState<AdminUserSummary[]>([]);
  const [usagePeriod, setUsagePeriod] = useState<AdminUsagePeriod>({ preset: 'all' });
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [isProviderLoading, setIsProviderLoading] = useState(false);
  // Re-resolve relative periods when reopening or refreshing after midnight.
  const usageRange = useMemo(() => resolveAdminUsageRange(usagePeriod), [usagePeriod, refreshVersion, isOpen]);
  const [providerUsage, setProviderUsage] = useState<ProviderUsageSummary | null>(null);
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());

  const [authorizedEmails, setAuthorizedEmails] = useState<AuthorizedEmail[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [isAddingEmail, setIsAddingEmail] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const loadAccessData = async () => {
    const emails = await getAuthorizedEmails();
    setAuthorizedEmails(emails);
  };

  const loadData = () => setRefreshVersion(previous => previous + 1);

  useEffect(() => {
    if (!isOpen) return;
    if (activeTab === 'settings') { setIsLoading(false); return; }
    let current = true;
    setIsLoading(true);
    if (activeTab === 'usage') setUsageError(null);
    else setAccessError(null);
    const load = async () => {
      try {
        if (activeTab === 'usage') {
          // Reconcile exact accepted H3 request costs before reading per-user
          // aggregates. Parallel reads could display the pre-refresh estimates.
          setIsProviderLoading(true);
          try {
            const usage = await getProviderUsageSummary();
            if (current) setProviderUsage(usage);
            // Server reconciliation continues if the report closes mid-refresh.
            // Notify the current workspace even when this report is obsolete.
            try { void Promise.resolve(billingReconciledRef.current?.()).catch(() => {}); }
            catch { /* Gallery refresh cannot invalidate a successful report. */ }
          } catch (error) {
            console.warn('Provider reconciliation unavailable:', error);
            if (current) setProviderUsage(null);
          } finally { if (current) setIsProviderLoading(false); }
          if (!current) return;
          const summaries = await getAdminUsageSummary(usageRange);
          if (current) setUserSummaries(summaries.sort((a, b) => b.total_cost - a.total_cost));
        } else {
          const emails = await getAuthorizedEmails();
          if (current) setAuthorizedEmails(emails);
        }
      } catch (error) {
        if (!current) return;
        if (activeTab === 'usage') setUsageError(error instanceof Error ? error.message : 'Could not load usage. Try again.');
        else setAccessError('Could not load authorized users. Try again.');
      } finally {
        if (current) setIsLoading(false);
      }
    };
    void load();
    // A slow response from an old period/tab must never replace the current report.
    return () => { current = false; };
  }, [isOpen, activeTab, usageRange, refreshVersion]);

  const handleAddEmail = async () => {
    const email = newEmail.toLowerCase().trim();
    if (!email || !email.includes('@')) return;
    if (authorizedEmails.some(e => e.email === email)) {
      setAccessError('This email is already authorized.');
      return;
    }

    setIsAddingEmail(true);
    setAccessError(null);
    try {
      await addAuthorizedEmail(email);
      setNewEmail('');
      await loadAccessData();
    } catch (e: any) {
      setAccessError(e.message || 'Failed to add email.');
    } finally {
      setIsAddingEmail(false);
    }
  };

  const handleRemoveEmail = async (entry: AuthorizedEmail) => {
    setRemovingId(entry.id);
    setAccessError(null);
    try {
      await removeAuthorizedEmail(entry.id);
      setAuthorizedEmails(prev => prev.filter(e => e.id !== entry.id));
    } catch (e: any) {
      setAccessError(e.message || 'Failed to remove email.');
    } finally {
      setRemovingId(null);
    }
  };

  if (!isOpen) return null;

  const toggleUserModels = (userId: string) => setExpandedUsers(previous => {
    const next = new Set(previous);
    if (next.has(userId)) next.delete(userId); else next.add(userId);
    return next;
  });

  const totalUsers = userSummaries.length;
  const totalCost = userSummaries.reduce((sum, u) => sum + u.total_cost, 0);
  const totalImages = userSummaries.reduce((sum, u) => sum + u.total_images, 0);
  const totalVideos = userSummaries.reduce((sum, u) => sum + (u.total_videos || 0), 0);
  const totalEnhances = userSummaries.reduce((sum, u) => sum + (u.total_enhances || 0), 0);
  const totalImageCost = userSummaries.reduce((sum, u) => sum + (u.image_cost || 0), 0);
  const totalVideoCost = userSummaries.reduce((sum, u) => sum + (u.video_cost || 0), 0);
  const totalEnhanceCost = userSummaries.reduce((sum, u) => sum + (u.enhance_cost || 0), 0);
  const unknownCostRequests = userSummaries.reduce((sum, user) => sum + (user.unknown_cost_requests ?? user.model_usage?.reduce((count, row) => count + row.unknown_cost_requests, 0) ?? 0), 0);
  const seedance25Rates = (['480p', '720p', '1080p'] as VideoQuality[]).map(quality => ({
    quality,
    rate: getEvoLinkVideoPricing('seedance-2.5', quality),
  }));

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 backdrop-blur-sm sm:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="admin-dashboard-title" className="bg-[#161b22] sm:border border-gray-800 sm:rounded-2xl w-full min-w-0 max-w-4xl h-[100dvh] sm:h-auto sm:max-h-[85dvh] flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:p-6 border-b border-gray-800">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="hidden sm:flex shrink-0 w-10 h-10 bg-violet-500/20 rounded-xl items-center justify-center">
              <BarChart3 className="w-5 h-5 text-violet-400" />
            </div>
            <div className="min-w-0">
              <h2 id="admin-dashboard-title" className="text-base sm:text-lg font-bold text-white">Admin Dashboard</h2>
              <p className="text-[11px] sm:text-xs text-gray-500">Usage reports and access control</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center sm:gap-2">
            <button
              onClick={loadData}
              disabled={isLoading}
              className="flex h-11 w-11 items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              aria-label="Refresh admin data"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="flex h-11 w-11 items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
              aria-label="Close admin dashboard"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-3 sm:flex shrink-0 border-b border-gray-800 px-2 sm:px-6" aria-label="Admin sections">
          <button
            onClick={() => setActiveTab('usage')}
            aria-pressed={activeTab === 'usage'}
            className={`min-w-0 px-2 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'usage'
                ? 'border-violet-400 text-violet-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            <span className="flex items-center justify-center gap-1.5 sm:gap-2 whitespace-nowrap">
              <BarChart3 className="w-4 h-4 shrink-0" />
              <span className="sm:hidden">Usage</span><span className="hidden sm:inline">Usage & Costs</span>
            </span>
          </button>
          <button
            onClick={() => setActiveTab('access')}
            aria-pressed={activeTab === 'access'}
            className={`min-w-0 px-2 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'access'
                ? 'border-violet-400 text-violet-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            <span className="flex items-center justify-center gap-1.5 sm:gap-2 whitespace-nowrap">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span className="sm:hidden">Access</span><span className="hidden sm:inline">Authorized Users</span>
              <span className="hidden sm:inline text-[10px] bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded-full font-bold">
                {authorizedEmails.length || '—'}
              </span>
            </span>
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            aria-pressed={activeTab === 'settings'}
            className={`min-w-0 px-2 sm:px-4 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'settings'
                ? 'border-violet-400 text-violet-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            <span className="flex items-center justify-center gap-1.5 sm:gap-2 whitespace-nowrap">
              <Settings className="w-4 h-4 shrink-0" />
              Settings
            </span>
          </button>
        </div>

        <div key={activeTab} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
        {activeTab === 'usage' && <AdminUsageFilter period={usagePeriod} range={usageRange} onChange={setUsagePeriod} />}
        {isLoading ? (
          <div role="status" className="flex-1 flex items-center justify-center gap-3 p-12 text-sm text-gray-400">
            <Loader2 className="w-8 h-8 text-violet-400 animate-spin" /> Loading {activeTab === 'usage' ? 'usage' : 'users'}…
          </div>
        ) : activeTab === 'usage' && usageError ? (
          <div className="p-4 sm:p-6">
            <p role="alert" className="text-sm text-amber-300">{usageError}</p>
            <button onClick={loadData} className="mt-3 min-h-11 rounded-lg bg-gray-800 px-4 text-sm text-white hover:bg-gray-700">Retry usage</button>
          </div>
        ) : activeTab === 'usage' ? (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 sm:p-6 border-b border-gray-800">
              <SummaryCard
                icon={ImageIcon}
                label="Images"
                value={`${totalImages.toLocaleString()} · $${totalImageCost.toFixed(2)}`}
                subtitle="App logged · all image models"
                color="green"
              />
              <SummaryCard
                icon={Video}
                label="Videos"
                value={`${totalVideos.toLocaleString()} · $${totalVideoCost.toFixed(2)}`}
                subtitle="App logged · all video models"
                color="amber"
              />
              <SummaryCard icon={Wand2} label="Text tasks" value={`${totalEnhances.toLocaleString()} · $${totalEnhanceCost.toFixed(2)}`} subtitle="Enhance · brainstorm · variation" color="violet" />
              <SummaryCard
                icon={DollarSign}
                label="App logged cost"
                value={`$${totalCost.toFixed(2)}`}
                subtitle={unknownCostRequests > 0 ? `${unknownCostRequests.toLocaleString()} requests have unknown cost` : 'Recorded charges and estimates'}
                color="green"
              />
            </div>

            {isProviderLoading ? <p role="status" className="px-4 pt-4 text-xs text-gray-400 sm:px-6">Loading provider account reports…</p>
              : <AdminProviderUsage usage={providerUsage} />}

            {/* Reset Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b border-gray-800 bg-gray-900/30">
              <div className="min-w-0">
                <p className="text-[11px] leading-relaxed text-gray-500">User totals come from app logs. Provider spend without a saved user/task link cannot be attributed retroactively. Resetting app logs does not reset provider billing.</p>
              </div>
              <button
                onClick={async () => {
                  if (!confirm('Reset ALL app usage logs, including dates outside the selected range? Provider totals from EvoLink/fal.ai are not reset. This cannot be undone.')) return;
                  setIsResetting(true);
                  try {
                    await resetUsageLogs();
                    loadData();
                  } catch (e: any) {
                    console.error('Reset failed:', e);
                    alert(`Reset failed: ${e.message}`);
                  } finally {
                    setIsResetting(false);
                  }
                }}
                disabled={isResetting}
                className="flex shrink-0 self-start sm:self-auto min-h-11 items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
              >
                {isResetting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                Reset All Usage
              </button>
            </div>

            {/* Users Table */}
            <div className="p-4 sm:p-6">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Users · {totalUsers}</h3>
              <p className="mb-4 text-[11px] leading-relaxed text-gray-500">App logs for currently authorized users in the selected period. Logged USD includes recorded provider charges and estimates; missing costs are unknown. Counts reflect logged requests, not verified successful outputs.</p>
              {totalUsers > 0 && userSummaries.every(user => !user.model_usage?.length) && <p role="status" className="mb-4 rounded-lg border border-gray-800 p-3 text-sm text-gray-400">No usage logged in this time range. Authorized users are shown below with zero usage.</p>}
              <div className="space-y-3 md:hidden">
                {userSummaries.length === 0 ? <p className="py-8 text-center text-sm text-gray-500">No users yet</p> : userSummaries.map(user => (
                  <div key={user.user_id} className="w-full min-w-0 rounded-xl border border-gray-800 bg-gray-900/40 p-4">
                    <button onClick={() => onViewUserGallery(user)} aria-label={`Open ${user.display_name || user.email}'s gallery`} className="flex w-full items-start gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
                      <UserAvatar user={user} />
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-medium text-white">{user.display_name || 'Unknown'}</p>
                        <p className="mt-0.5 break-all text-xs text-gray-500">{user.email}</p>
                      </div>
                      <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-violet-400" />
                    </button>
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <UserMetric label="Images" count={user.total_images} cost={user.image_cost} />
                      <UserMetric label="Videos" count={user.total_videos} cost={user.video_cost} />
                      <UserMetric label="Text tasks" count={user.total_enhances} cost={user.enhance_cost} />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-800 pt-3">
                      <button onClick={() => toggleUserModels(user.user_id)} aria-expanded={expandedUsers.has(user.user_id)} aria-controls={`user-models-mobile-${user.user_id}`} className="flex min-h-11 items-center gap-1 text-xs font-medium text-violet-400">
                        Models ({user.model_usage?.length || 0})<ChevronDown className={`h-3.5 w-3.5 transition-transform ${expandedUsers.has(user.user_id) ? 'rotate-180' : ''}`} />
                      </button>
                      <div className="text-right"><span className="text-sm font-mono text-green-400">${user.total_cost.toFixed(2)}</span>{(user.unknown_cost_requests || 0) > 0 && <span className="block text-[10px] text-amber-300">+ {user.unknown_cost_requests} unknown cost</span>}</div>
                    </div>
                    {expandedUsers.has(user.user_id) && <div id={`user-models-mobile-${user.user_id}`} className="mt-3 border-t border-gray-800 pt-3"><AdminModelUsage rows={user.model_usage || []} label={`${user.display_name || user.email} model usage`} /></div>}
                  </div>
                ))}
              </div>
              <table className="hidden md:table w-full table-fixed">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                    <th className="w-[42%] pb-3 pl-2">User</th>
                    <th className="pb-3 text-right">Images</th>
                    <th className="pb-3 text-right">Videos</th>
                    <th className="pb-3 text-right">Text tasks</th>
                    <th className="pb-3 text-right pr-2">Logged Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {userSummaries.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-12 text-gray-500">
                        No users yet
                      </td>
                    </tr>
                  ) : (
                    userSummaries.map(user => (
                      <React.Fragment key={user.user_id}>
                      <tr
                        className="border-b border-gray-800/50 hover:bg-violet-500/5 transition-colors group"
                      >
                        <td className="py-3 pl-2">
                          <button onClick={() => onViewUserGallery(user)} aria-label={`Open ${user.display_name || user.email}'s gallery`} className="flex w-full items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
                            <UserAvatar user={user} />
                            <div className="min-w-0">
                              <p className="break-words text-sm font-medium text-white">{user.display_name || 'Unknown'}</p>
                              <p className="break-all text-xs text-gray-500">{user.email}</p>
                              <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-violet-400">
                                Open gallery <ExternalLink className="w-2.5 h-2.5" />
                              </span>
                            </div>
                          </button>
                        </td>
                        <td className="py-3 text-right text-sm text-gray-300">
                          <div>{user.total_images.toLocaleString()}</div>
                          <div className="text-[10px] text-gray-500">${(user.image_cost || 0).toFixed(2)}</div>
                        </td>
                        <td className="py-3 text-right text-sm text-gray-300">
                          <div>{(user.total_videos || 0).toLocaleString()}</div>
                          <div className="text-[10px] text-gray-500">${(user.video_cost || 0).toFixed(2)}</div>
                        </td>
                        <td className="py-3 text-right text-sm text-gray-300">
                          <div>{(user.total_enhances || 0).toLocaleString()}</div>
                          <div className="text-[10px] text-gray-500">${(user.enhance_cost || 0).toFixed(2)}</div>
                        </td>
                        <td className="py-3 text-right pr-2">
                          <span className="text-sm font-mono text-green-400">${user.total_cost.toFixed(2)}</span>
                          {(user.unknown_cost_requests || 0) > 0 && <span className="mt-0.5 block text-[10px] text-amber-300">+ {user.unknown_cost_requests} unknown cost</span>}
                          <button onClick={() => toggleUserModels(user.user_id)} aria-expanded={expandedUsers.has(user.user_id)} aria-controls={`user-models-desktop-${user.user_id}`} className="ml-auto mt-1 flex min-h-8 items-center gap-1 text-[10px] font-medium text-violet-400">
                            Models ({user.model_usage?.length || 0})<ChevronDown className={`h-3 w-3 transition-transform ${expandedUsers.has(user.user_id) ? 'rotate-180' : ''}`} />
                          </button>
                        </td>
                      </tr>
                      {expandedUsers.has(user.user_id) && <tr><td colSpan={5} className="border-b border-gray-800 bg-gray-950/30 px-3 py-3"><div id={`user-models-desktop-${user.user_id}`}><AdminModelUsage rows={user.model_usage || []} label={`${user.display_name || user.email} model usage`} /></div></td></tr>}
                      </React.Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : activeTab === 'access' ? (
          /* Access Control Tab */
          <div className="p-4 sm:p-6">
            <div className="mb-6">
              <p className="text-sm text-gray-400 mb-4">
                Only users whose email appears below can sign in. Add emails to grant access.
              </p>

              {/* Add email input */}
              <div className="flex gap-2">
                <div className="min-w-0 flex-1 relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="email"
                    aria-label="Email to authorize"
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={newEmail}
                    onChange={e => { setNewEmail(e.target.value); setAccessError(null); }}
                    onKeyDown={e => e.key === 'Enter' && handleAddEmail()}
                    placeholder="user@example.com"
                    className="w-full bg-gray-900/50 border border-gray-700 rounded-lg pl-10 pr-3 py-2.5 text-base sm:text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 transition-colors"
                  />
                </div>
                <button
                  onClick={handleAddEmail}
                  disabled={isAddingEmail || !newEmail.trim()}
                  className="flex shrink-0 items-center gap-1.5 px-3 sm:px-4 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {isAddingEmail ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  Add
                </button>
              </div>

              {accessError && (
                <p className="mt-2 text-xs text-red-400">{accessError}</p>
              )}
            </div>

            {/* Authorized emails list */}
            <div className="space-y-1">
              {authorizedEmails.length === 0 ? (
                <div className="text-center py-12 text-gray-500 text-sm">
                  No authorized emails yet. Add one above to get started.
                </div>
              ) : (
                authorizedEmails.map(entry => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-2 px-2 sm:px-4 py-3 rounded-lg hover:bg-gray-800/40 transition-colors group"
                  >
                    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                      <div className="w-8 h-8 shrink-0 rounded-full bg-emerald-500/10 flex items-center justify-center">
                        <Mail className="w-3.5 h-3.5 text-emerald-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="break-all text-sm text-white">{entry.email}</p>
                        <p className="text-[10px] text-gray-600">
                          Added {new Date(entry.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveEmail(entry)}
                      disabled={removingId === entry.id}
                      className="flex h-11 w-11 shrink-0 items-center justify-center text-gray-400 hover:text-red-400 hover:bg-red-500/10 focus-visible:text-red-400 rounded-lg transition-colors"
                      aria-label={`Remove access for ${entry.email}`}
                      title="Remove access"
                    >
                      {removingId === entry.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : activeTab === 'settings' ? (
          <div className="p-4 sm:p-6">
            <div className="max-w-2xl">
              <TextModelSettings />

              <div className="mb-6">
                <div className="flex items-center gap-2 mb-1">
                  <Video className="w-4 h-4 text-amber-400" />
                  <h3 className="text-sm font-semibold text-white">Seedance 2.5 Relaxed Pricing</h3>
                </div>
                <p className="text-xs text-gray-500 mb-4">
                  Includes EvoLink’s 10% relaxed-channel surcharge for content_filter:false. Provider safety and input-review policies still apply; real-person editing is not guaranteed. Accepted tasks replace estimates with provider-reserved credits.
                </p>

                <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900/40">
                  <div className="grid grid-cols-[0.65fr_1fr_1fr] sm:grid-cols-3 gap-2 border-b border-gray-800 px-3 sm:px-4 py-2 text-[10px] font-bold uppercase text-gray-500">
                    <span>Quality</span>
                    <span>Generate</span>
                    <span>Video input</span>
                  </div>
                  {seedance25Rates.map(({ quality, rate }) => (
                    <div key={quality} className="grid grid-cols-[0.65fr_1fr_1fr] sm:grid-cols-3 gap-2 border-b border-gray-800/60 px-3 sm:px-4 py-3 text-xs last:border-b-0">
                      <span className="font-semibold text-white">{quality}</span>
                      <span className="text-gray-300">${rate.noVideoInput.toFixed(3)}/s · {rate.credits.noVideoInput.toFixed(2)} cr</span>
                      <span className="text-gray-300">${rate.withVideoInput.toFixed(3)}/s · {rate.credits.withVideoInput.toFixed(2)} cr</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[10px] leading-relaxed text-gray-500">
                  Video-reference, Edit, and Extend billing: (max total input seconds, output seconds) + output seconds.
                  {isSeedance25PromoActive() ? ' The displayed 1080p rate includes EvoLink’s promotion through September 17, 2026 (UTC+8).' : ' The displayed 1080p rate uses EvoLink’s post-promotion 2.5× 720p multiplier.'}
                </p>
              </div>

              <div className="mb-6">
                <div className="flex items-center gap-2 mb-1">
                  <Video className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-sm font-semibold text-white">MiniMax H3 fal.ai Pricing</h3>
                </div>
                <p className="text-xs text-gray-500 mb-4">
                  Published regular output rates by action; promotions may reduce actual charges. Reference processing may add cost. Lip Sync over 15s has a 1.2× output multiplier. Actual provider billing takes precedence.
                </p>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
                  H3 Max regular output rates
                </p>
                <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900/40">
                  {H3_MAX_MODE_OPTIONS.map(({value, label}) => (
                    <div key={value} className="border-b border-gray-800/60 px-4 py-3 text-xs last:border-b-0">
                      <span className="font-semibold text-white">{label}</span>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-gray-300">
                        {Object.entries(H3_MAX_OUTPUT_RATES[value]).map(([quality, rate]) => <span key={quality}>{quality} · ${rate.toFixed(3)}/s</span>)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}
        </div>
      </div>
    </div>
  );
};

// --- Summary Card Sub-component ---
const SummaryCard: React.FC<{
  icon: React.ElementType;
  label: string;
  value: string;
  subtitle?: string;
  color: 'blue' | 'green' | 'amber' | 'violet';
}> = ({ icon: Icon, label, value, subtitle, color }) => {
  const colors = {
    blue: 'bg-blue-500/10 text-blue-400',
    green: 'bg-green-500/10 text-green-400',
    amber: 'bg-amber-500/10 text-amber-400',
    violet: 'bg-violet-500/10 text-violet-400',
  };

  return (
    <div className="min-w-0 bg-gray-900/50 border border-gray-800 rounded-xl p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center ${colors[color]}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">{label}</span>
      </div>
      <p className="break-words text-lg sm:text-xl font-bold tabular-nums text-white">{value}</p>
      {subtitle && <p className="mt-1 text-[10px] leading-relaxed text-gray-500">{subtitle}</p>}
    </div>
  );
};

const UserAvatar = ({ user }: { user: AdminUserSummary }) => user.avatar_url
  ? <img src={user.avatar_url} alt="" className="w-8 h-8 shrink-0 rounded-full object-cover" />
  : <span className="w-8 h-8 shrink-0 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-400">{(user.display_name || user.email || '?')[0].toUpperCase()}</span>;

const UserMetric = ({ label, count, cost }: { label: string; count: number; cost: number }) => (
  <div className="min-w-0">
    <p className="text-[10px] text-gray-500">{label}</p>
    <p className="break-words text-sm tabular-nums text-gray-200">{(count || 0).toLocaleString()}</p>
    <p className="break-words text-[10px] tabular-nums text-gray-500">${(cost || 0).toFixed(2)}</p>
  </div>
);
