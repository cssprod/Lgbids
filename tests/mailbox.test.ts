import { beforeEach, describe, expect, it, vi } from 'vitest';

// A fake ImapFlow that records every call, so the tests can check the adapter
// only reads: no flags, moves or deletes, ever.
const state = vi.hoisted(() => ({
  instances: [] as FakeClient[],
  gmail: false,
  found: [] as number[],
  uidNext: 100,
  uidValidity: 7,
  fail: null as Error | null,
  from: new Map<number, string>(),
}));

interface FakeClient {
  options: Record<string, unknown>;
  calls: { name: string; args: unknown[] }[];
}

vi.mock('imapflow', () => {
  class ImapFlow {
    options: Record<string, unknown>;
    calls: { name: string; args: unknown[] }[] = [];
    capabilities: Map<string, boolean>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      this.capabilities = new Map(state.gmail ? [['X-GM-EXT-1', true]] : []);
      state.instances.push(this as unknown as FakeClient);
      for (const name of ['messageFlagsAdd', 'messageFlagsSet', 'messageFlagsRemove', 'messageMove', 'messageDelete', 'messageCopy', 'append']) {
        (this as Record<string, unknown>)[name] = (...args: unknown[]) => {
          this.calls.push({ name, args });
          throw new Error(`${name} must never be called`);
        };
      }
    }
    async connect() {
      this.calls.push({ name: 'connect', args: [] });
    }
    async mailboxOpen(...args: unknown[]) {
      this.calls.push({ name: 'mailboxOpen', args });
      if (state.fail) throw state.fail;
      return { uidValidity: state.uidValidity, uidNext: state.uidNext };
    }
    async search(...args: unknown[]) {
      this.calls.push({ name: 'search', args });
      return state.found;
    }
    async *fetch(...args: unknown[]) {
      this.calls.push({ name: 'fetch', args });
      for (const uid of args[0] as number[]) {
        const from = state.from.get(uid) ?? 'BC Bid <noreply@bcbid.example>';
        yield { uid, source: Buffer.from(`From: ${from}\r\n\r\nhi`), envelope: { from: [{ name: from.split(' <')[0], address: 'x@sender.example' }] } };
      }
    }
    async logout() {
      this.calls.push({ name: 'logout', args: [] });
    }
    close() {
      this.calls.push({ name: 'close', args: [] });
    }
  }
  return { ImapFlow };
});

import { createImapMailbox, gmailFromQuery, planFetch } from '../src/server/sources/alerts/mailbox.js';

const settings = {
  host: 'imap.mail.example',
  port: 993,
  secure: true,
  user: 'me@mail.example',
  pass: 'app-password',
  folder: 'INBOX',
  lookbackDays: 14,
  verifiedAt: null,
};
const now = new Date('2026-06-15T12:00:00Z');
const last = () => state.instances[state.instances.length - 1]!;
const names = () => last().calls.map((c) => c.name);

beforeEach(() => {
  state.instances.length = 0;
  state.gmail = false;
  state.found = [];
  state.uidNext = 100;
  state.uidValidity = 7;
  state.fail = null;
  state.from.clear();
});

describe('planFetch', () => {
  it('starts at uidNext-1 when the look-back finds nothing and there is no position', () => {
    expect(planFetch([], null, 50, 200)).toEqual({ uids: [], lastUid: 199 });
  });
  it('resumes after the saved position', () => {
    expect(planFetch([12, 10, 11], 10, 50, 13)).toEqual({ uids: [11, 12], lastUid: 12 });
    expect(planFetch([], 10, 50, 13)).toEqual({ uids: [], lastUid: 10 });
  });
  it('ignores the N:* quirk that always returns the newest message', () => {
    expect(planFetch([8], 10, 50, 11)).toEqual({ uids: [], lastUid: 10 });
  });
  it('caps the batch, oldest first, so the rest come next run', () => {
    expect(planFetch([5, 3, 4, 1, 2], null, 2, 6)).toEqual({ uids: [1, 2], lastUid: 2 });
  });
});

describe('IMAP adapter', () => {
  it('opens read-only, searches with the FROM terms and fetches only the found UIDs', async () => {
    state.found = [41, 42];
    state.from.set(42, 'Pat <pat@friend.example>');
    const out = await createImapMailbox(settings).fetchNew(null, { now, lookbackDays: 14, max: 50 });
    const calls = last().calls;
    expect(calls.find((c) => c.name === 'mailboxOpen')!.args).toEqual(['INBOX', { readOnly: true }]);
    const query = calls.find((c) => c.name === 'search')!.args[0] as { or: { from: string }[] };
    expect(query.or.map((o) => o.from)).toEqual(expect.arrayContaining(['bcbid', 'canadabuys', 'bidsandtenders']));
    expect(calls.find((c) => c.name === 'fetch')!.args[0]).toEqual([41, 42]);
    // The From header is re-checked: the friend's mail is dropped.
    expect(out.messages.map((m) => m.id)).toEqual(['imap:41']);
    expect(out.position).toEqual({ uidValidity: '7', lastUid: 42 });
    expect(names()).not.toEqual(expect.arrayContaining(['messageFlagsAdd', 'messageMove', 'messageDelete']));
    expect(names()).toContain('logout');
  });

  it('uses X-GM-RAW on Gmail', async () => {
    state.gmail = true;
    await createImapMailbox(settings).fetchNew({ uidValidity: '7', lastUid: 40 }, { now, lookbackDays: 14, max: 50 });
    const query = last().calls.find((c) => c.name === 'search')!.args[0] as Record<string, unknown>;
    expect(query).toEqual({ uid: '41:*', gmraw: gmailFromQuery() });
    expect(gmailFromQuery()).toContain('bcbid.gov.bc.ca OR gobonfire.com');
  });

  it('starts over when UIDVALIDITY changes', async () => {
    state.found = [];
    const out = await createImapMailbox(settings).fetchNew({ uidValidity: '6', lastUid: 900 }, { now, lookbackDays: 14, max: 50 });
    const query = last().calls.find((c) => c.name === 'search')!.args[0] as Record<string, unknown>;
    expect(query.since).toBeInstanceOf(Date);
    expect(out.position).toEqual({ uidValidity: '7', lastUid: 99 });
  });

  it('counts alerts per sender in Test', async () => {
    state.found = [1, 2, 3];
    state.from.set(2, 'CanadaBuys <no-reply@canadabuys.example>');
    state.from.set(3, 'Pat <pat@friend.example>');
    const result = await createImapMailbox(settings).test({ now, lookbackDays: 14 });
    expect(result).toEqual({ count: 2, bySender: { bcbid: 1, canadabuys: 1 } });
    expect(last().calls.find((c) => c.name === 'fetch')!.args[1]).not.toHaveProperty('source');
  });

  it('logs out after an error', async () => {
    state.fail = Object.assign(new Error('no such mailbox'), { mailboxMissing: true });
    await expect(createImapMailbox(settings).test({ now, lookbackDays: 14 })).rejects.toThrow(/folder/);
    expect(names()).toContain('logout');
  });

  it('asks for STARTTLS on a plain connection to a remote host, not to loopback', () => {
    createImapMailbox({ ...settings, secure: false, port: 143 }).test({ now, lookbackDays: 1 });
    expect(last().options.doSTARTTLS).toBe(true);
    createImapMailbox({ ...settings, secure: false, host: '127.0.0.1' }).test({ now, lookbackDays: 1 });
    expect(last().options.doSTARTTLS).toBeUndefined();
    createImapMailbox(settings).test({ now, lookbackDays: 1 });
    expect(last().options.doSTARTTLS).toBeUndefined();
  });
});
