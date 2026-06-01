import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ipc } from '@/lib/ipc';
import { unwrap } from '@/lib/result';
import { aiKeys } from './useAi';
import type {
  OrgCreateMeetingPayload,
  OrgChatPayload,
  OrgShareMeetingPayload,
} from '@/lib/ipc';

export const orgKeys = {
  all: ['org'] as const,
  status: () => [...orgKeys.all, 'status'] as const,
  meetings: () => [...orgKeys.all, 'meetings'] as const,
  meeting: (id: string) => [...orgKeys.all, 'meeting', id] as const,
  autoBackup: () => [...orgKeys.all, 'auto-backup'] as const,
  backupState: (summaryFile: string) => [...orgKeys.all, 'backup-state', summaryFile] as const,
};

export function useOrgSession() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: orgKeys.status(),
    queryFn: () => ipc().org.status(),
    staleTime: 60_000,
  });

  // Precise expiry detection: when the response carries a JWT exp claim,
  // schedule a one-shot timer to invalidate this query at exactly that
  // moment. The next refetch lands in main's org-status, which sees the
  // expired token, clears the session, and returns signedIn:false — the
  // sidebar swaps to the "Sign in" CTA without any polling or staleness.
  //
  // Edge cases:
  // - exp in the past (clock skew, race): delay clamps to 0, fires
  //   immediately
  // - exp very far out (30-day TTL): setTimeout's max delay is ~2^31 ms
  //   (~24.8 days). For longer values we cap at MAX_TIMEOUT and let the
  //   effect re-run after invalidation — costs one extra IPC every ~23
  //   days, negligible.
  // - exp unset (signed out, malformed): effect skips, no timer
  const exp = query.data?.signedIn ? query.data.exp : undefined;
  React.useEffect(() => {
    if (typeof exp !== 'number') return;
    const MAX_TIMEOUT = 2_000_000_000; // safe upper bound for setTimeout
    const delay = Math.max(0, Math.min(exp * 1000 - Date.now(), MAX_TIMEOUT));
    const id = setTimeout(() => {
      qc.invalidateQueries({ queryKey: orgKeys.status() });
    }, delay);
    return () => clearTimeout(id);
  }, [exp, qc]);

  return query;
}

// Sign-in / sign-out auto-switches the Python-side ai_provider (between
// 'adapter' and the user's previous choice), so the renderer's
// useAiProvider query needs to refetch — otherwise Settings > AI keeps
// showing stale "adapter" copy after a sign-out, or "local" after a
// sign-in. Invalidating both query namespaces on every org auth
// transition keeps the renderer aligned with main's state.
function invalidateOrgAndAi(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: orgKeys.all });
  qc.invalidateQueries({ queryKey: aiKeys.all });
}

export function useOrgLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      adapterUrl: string;
      email: string;
      password: string;
    }) => unwrap(await ipc().org.login(args.adapterUrl, args.email, args.password)),
    onSuccess: () => invalidateOrgAndAi(qc),
  });
}

/** Google OIDC sign-in. Opens the system browser, waits for the loopback
 *  callback, exchanges the code via the adapter, and persists the resulting
 *  session — same shape as useOrgLogin so all downstream consumers (sidebar,
 *  profile chip, AskBar gating) react identically. */
export function useOrgSsoGoogle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (adapterUrl: string) =>
      unwrap(await ipc().org.ssoGoogleStart(adapterUrl)),
    onSuccess: () => invalidateOrgAndAi(qc),
  });
}

export function useOrgLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => ipc().org.logout(),
    onSuccess: () => invalidateOrgAndAi(qc),
  });
}

export function useOrgMeetings(enabled = true) {
  return useQuery({
    queryKey: orgKeys.meetings(),
    queryFn: async () => unwrap(await ipc().org.listMeetings()).meetings,
    enabled,
    staleTime: 5_000,
  });
}

export function useOrgMeeting(id: string | null) {
  return useQuery({
    queryKey: id ? orgKeys.meeting(id) : ['org', 'meeting', 'none'],
    queryFn: async () => unwrap(await ipc().org.getMeeting(id!)).meeting,
    enabled: !!id,
  });
}

/** Three-step share: presign → PUT to S3 → register meeting metadata.
 *  All orchestrated in main.js so the bytes never touch the renderer
 *  process and we get a single round-trip from the caller's view.
 *
 *  Also invalidates the per-summary backup-state cache so the
 *  MeetingDetail Share/Unshare toggle flips to "Unshare" immediately
 *  after a successful manual share. */
export function useShareToOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: OrgShareMeetingPayload) =>
      unwrap(await ipc().org.shareMeeting(payload)).meeting,
    onSuccess: (_data, payload) => {
      qc.invalidateQueries({ queryKey: orgKeys.meetings() });
      if (payload.summaryFile) {
        qc.invalidateQueries({ queryKey: orgKeys.backupState(payload.summaryFile) });
      }
    },
  });
}

/** Unshare a note by org meeting_id. Adapter deletes the metadata + the
 *  S3 object atomically; owner-only (the adapter 403s otherwise). Does
 *  not touch the local `.org-backup-state.json` flag — use
 *  `useUnshareFromOrgBySummary` for the MeetingDetail toggle, which
 *  keeps the two stores in sync. */
export function useUnshareOrgMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await ipc().org.deleteMeeting(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: orgKeys.meetings() }),
  });
}

/** Per-note share state for the MeetingDetail Share/Unshare toggle.
 *  Reads the persistent `.org-backup-state.json` flag so the toggle
 *  reflects "has this note ever been shared" rather than transient
 *  "did I just click Share". `summaryFile === null` disables the
 *  query — used on routes that don't have a current meeting context. */
export function useOrgBackupState(summaryFile: string | null) {
  return useQuery({
    queryKey: summaryFile
      ? orgKeys.backupState(summaryFile)
      : [...orgKeys.all, 'backup-state', 'none'],
    queryFn: async () => {
      const res = unwrap(await ipc().org.getBackupState(summaryFile!));
      return { shared: res.shared, meeting_id: res.meeting_id };
    },
    enabled: !!summaryFile,
    staleTime: 0,
  });
}

/** Unshare a note by summary file. Deletes the org-side meeting AND
 *  clears the local `.org-backup-state.json` entry so a follow-up Share
 *  / auto-share isn't suppressed as "already attempted". The matching
 *  query invalidation flips the toggle back to "Share with {org}". */
export function useUnshareFromOrgBySummary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (summaryFile: string) => {
      const res = unwrap(await ipc().org.unshareBySummary(summaryFile));
      return res;
    },
    onSuccess: (_data, summaryFile) => {
      qc.invalidateQueries({ queryKey: orgKeys.backupState(summaryFile) });
      qc.invalidateQueries({ queryKey: orgKeys.meetings() });
    },
  });
}

/** Inline-body create — kept for cases where we genuinely don't want to
 *  hit S3 (legacy / fallback). The default share path uses useShareToOrg. */
export function useCreateOrgMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: OrgCreateMeetingPayload) =>
      unwrap(await ipc().org.createMeeting(payload)).meeting,
    onSuccess: () => qc.invalidateQueries({ queryKey: orgKeys.meetings() }),
  });
}


export function useOrgAiChat() {
  return useMutation({
    mutationFn: async (payload: OrgChatPayload) =>
      unwrap(await ipc().org.aiChat(payload)),
  });
}

/** Auto-backup preference. Lives in the Python config (so it persists in
 *  config.json alongside notifications/telemetry) and applies whenever the
 *  user is signed in to the enterprise adapter. Default true — connecting
 *  the adapter implies the user wants their notes available to the org. */
export function useOrgAutoBackup() {
  return useQuery({
    queryKey: orgKeys.autoBackup(),
    queryFn: async () => unwrap(await ipc().org.getAutoBackup()).org_auto_backup_enabled,
    staleTime: 60_000,
  });
}

export function useSetOrgAutoBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) =>
      unwrap(await ipc().org.setAutoBackup(enabled)).org_auto_backup_enabled,
    onSuccess: (enabled) => {
      qc.setQueryData(orgKeys.autoBackup(), enabled);
    },
  });
}
