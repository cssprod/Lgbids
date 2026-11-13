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

type Fetcher = (url: string) => Promise<{ status: number; text: string }>;

export class RobotsCache {
  private readonly cache = new Map<string, { groups: Group[]; at: number }>();
  private readonly pending = new Map<string, Promise<Group[]>>();

  constructor(
    private readonly userAgent: string,
    private readonly fetcher: Fetcher,
    private readonly ttlMs = 12 * 3600 * 1000,
  ) {}

  private async load(origin: string): Promise<Group[]> {
    try {
      const result = await this.fetcher(`${origin}/robots.txt`);
      // Only a real robots.txt counts; an HTML error page served with 200 does not.
      if (result.status === 200 && !/<html/i.test(result.text.slice(0, 500))) return parseRobots(result.text);
    } catch {
      // No robots.txt, or it could not be fetched: the convention is that
      // nothing is disallowed.
    }
    return [];
  }

  async allowed(url: string): Promise<boolean> {
    const target = new URL(url);
    const cached = this.cache.get(target.origin);
    let groups: Group[];
    if (cached && Date.now() - cached.at < this.ttlMs) {
      groups = cached.groups;
    } else {
      let pending = this.pending.get(target.origin);
      if (!pending) {
        pending = this.load(target.origin).finally(() => this.pending.delete(target.origin));
        this.pending.set(target.origin, pending);
      }
      groups = await pending;
      this.cache.set(target.origin, { groups, at: Date.now() });
    }
    return isAllowed(groups, this.userAgent, `${target.pathname}${target.search}`);
  }
}
