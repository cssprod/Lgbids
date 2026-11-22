/**
 * A small robots.txt reader: enough to honour Allow / Disallow rules for our
 * own user agent or the "*" group, with "*" and "$" wildcards and
 * longest-match precedence, as search engines interpret them.
 */

interface Rule {
  allow: boolean;
  pattern: string;
  re: RegExp;
}

interface Group {
  agents: string[];
  rules: Rule[];
}

function toRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

export function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === 'allow' || field === 'disallow') && current) {
      lastWasAgent = false;
      // An empty Disallow means "nothing is disallowed".
      if (value) current.rules.push({ allow: field === 'allow', pattern: value, re: toRegex(value) });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

/** Is this path (with query string) allowed for the given product token? */
export function isAllowed(groups: Group[], userAgent: string, pathAndQuery: string): boolean {
  const token = userAgent.split(/[/\s(]/)[0]!.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token && (a.includes(token) || token.includes(a))));
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes('*'));
  let best: Rule | null = null;
  for (const group of chosen) {
    for (const rule of group.rules) {
      if (!rule.re.test(pathAndQuery)) continue;
      if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule;
    }
  }
  return best ? best.allow : true;
}

/**
 * Fetches a robots.txt. It resolves with the status for a 2xx or 4xx answer
 * and rejects for a 5xx answer, a network failure or a refused address.
 */
type Fetcher = (url: string) => Promise<{ status: number; text: string }>;

export interface RobotsVerdict {
  allowed: boolean;
  /** True when the robots.txt could not be read, which also counts as "not allowed". */
  unreadable: boolean;
}

interface Entry {
  groups: Group[];
  unreadable: boolean;
  at: number;
}

export class RobotsCache {
  private readonly cache = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<Omit<Entry, 'at'>>>();

  constructor(
    private readonly userAgent: string,
    private readonly fetcher: Fetcher,
    private readonly ttlMs = 12 * 3600 * 1000,
    /** An unreadable robots.txt is tried again sooner: the site may only be down for a moment. */
    private readonly failureTtlMs = 15 * 60 * 1000,
  ) {}

  private async load(origin: string): Promise<Omit<Entry, 'at'>> {
    try {
      const result = await this.fetcher(`${origin}/robots.txt`);
      // Only a real robots.txt counts; an HTML error page served with 200 does not.
      if (result.status === 200 && !/<html/i.test(result.text.slice(0, 500))) return { groups: parseRobots(result.text), unreadable: false };
      // A missing robots.txt (any 4xx) means the site sets no rules.
      return { groups: [], unreadable: false };
    } catch {
      // A server error or no answer at all: we cannot know the site's wishes,
      // so we stay away until it can be read (the cautious reading).
      return { groups: [], unreadable: true };
    }
  }

  async check(url: string): Promise<RobotsVerdict> {
    const target = new URL(url);
    const cached = this.cache.get(target.origin);
    let entry: Omit<Entry, 'at'>;
    if (cached && Date.now() - cached.at < (cached.unreadable ? this.failureTtlMs : this.ttlMs)) {
      entry = cached;
    } else {
      let pending = this.pending.get(target.origin);
      if (!pending) {
        pending = this.load(target.origin).finally(() => this.pending.delete(target.origin));
        this.pending.set(target.origin, pending);
      }
      entry = await pending;
      this.cache.set(target.origin, { ...entry, at: Date.now() });
    }
    if (entry.unreadable) return { allowed: false, unreadable: true };
    return { allowed: isAllowed(entry.groups, this.userAgent, `${target.pathname}${target.search}`), unreadable: false };
  }

  async allowed(url: string): Promise<boolean> {
    return (await this.check(url)).allowed;
  }
}
