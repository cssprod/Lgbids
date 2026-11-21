import type { DashboardResponse } from '../shared/api.js';
import type { Application, Opportunity, SetupItem } from '../shared/schemas.js';
import { profileGaps } from './applications/draft.js';
import type { AppDeps, Pipeline, Scheduler } from './contracts.js';
import { opportunityDto } from './routes/util.js';
import { emailConfigured } from './submission/email.js';

const DAY_MS = 86_400_000;
const LIST_MAX = 10;

function closingTime(opp: Opportunity | undefined): number {
  return opp?.closesAt ? new Date(opp.closesAt).getTime() : Number.POSITIVE_INFINITY;
}

/** Everything the home page shows, in one request. */
export function buildDashboard(deps: AppDeps, pipeline: Pipeline, scheduler: Scheduler): DashboardResponse {
  const { store, settings, config } = deps;
  const now = deps.now();
  const nowMs = now.getTime();

  const counts = store.countOpportunities(now);
  // The suitable view is ordered by closing date already; a generous limit covers any real backlog.
  const suitable = store
    .listOpportunities({ view: 'suitable', limit: 500 }, now)
    .items.map(opportunityDto)
    .filter((o) => o.status === 'open');
  const upcoming = suitable.filter((o) => o.closesAt !== null && closingTime(o) >= nowMs);
  const closingSoon = upcoming.filter((o) => closingTime(o) - nowMs <= 7 * DAY_MS).length;

  const attentionStatuses = ['needs_input', 'ready', 'failed'] as const;
  const open = store.listApplications({ status: [...attentionStatuses] });
  const byStatus = (status: Application['status']) => open.filter((a) => a.status === status).length;
  const attention = [...open].sort((a, b) => closingTime(a.opportunity) - closingTime(b.opportunity) || a.id - b.id).slice(0, LIST_MAX);
  const submitted = store.listApplications({ status: ['submitted'] }).length;

  const sources = store.listSources();
  const enabled = sources.filter((s) => s.enabled);
  const lastRun = store.latestRun() ?? null;

  const alertSource = sources.find((s) => s.kind === 'email_alerts');
  const profile = settings.getProfile();
  const email = settings.getEmail();
  const setup: SetupItem[] = [
    { key: 'profile', label: 'Fill in your company profile', done: profileGaps(profile).length === 0, href: '/profile' },
    {
      key: 'alerts',
      label: 'Connect your bid alert inbox (BC Bid and Bonfire)',
      // Connected, or alerts already read from imported e-mails.
      done: settings.getAlertInbox().verifiedAt !== null || (alertSource?.lastItemCount ?? 0) > 0,
      href: '/settings#alerts',
    },
    { key: 'services', label: 'Choose the services you offer', done: store.getSetting('profile') !== undefined, href: '/profile' },
    { key: 'email', label: 'Set up outgoing e-mail', done: emailConfigured(email) && !!email.verifiedAt, href: '/settings' },
    { key: 'documents', label: 'Upload your insurance and WorkSafeBC documents', done: store.listDocuments().length > 0, href: '/documents' },
    { key: 'run', label: 'Run the first search', done: lastRun !== null, href: '/' },
  ];

  return {
    mode: settings.getAutomation().mode,
    running: pipeline.isRunning(),
    lastRun,
    nextRunAt: scheduler.nextRunAt(),
    counts: {
      openSuitable: counts.suitable,
      review: counts.review,
      needsInput: byStatus('needs_input'),
      ready: byStatus('ready'),
      submitted,
      closingSoon,
      sourcesFailing: enabled.filter((s) => s.lastStatus === 'error' || s.lastStatus === 'blocked').length,
      sourcesEnabled: enabled.length,
      sourcesWarning: enabled.filter((s) => s.layoutWarning !== '').length,
      unseenChanges: store.countUnseenChanges(),
      // Worked out by UX-2 (submitted, 14 or more days past closing, no result).
      awaitingResult: 0,
    },
    attention,
    deadlines: upcoming.slice(0, LIST_MAX),
    setup,
    sources,
    demo: config.demo,
    timeZone: config.timeZone,
  };
}
