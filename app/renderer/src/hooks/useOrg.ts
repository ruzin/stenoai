import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ipc } from '@/lib/ipc';
import { unwrap } from '@/lib/result';
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
};

export function useOrgSession() {
  return useQuery({
    queryKey: orgKeys.status(),
    queryFn: () => ipc().org.status(),
    staleTime: 60_000,
  });
}

export function useOrgLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      adapterUrl: string;
      email: string;
      password: string;
    }) => unwrap(await ipc().org.login(args.adapterUrl, args.email, args.password)),
    onSuccess: () => qc.invalidateQueries({ queryKey: orgKeys.all }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: orgKeys.all }),
  });
}

export function useOrgLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => ipc().org.logout(),
    onSuccess: () => qc.invalidateQueries({ queryKey: orgKeys.all }),
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
 *  process and we get a single round-trip from the caller's view. */
export function useShareToOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: OrgShareMeetingPayload) =>
      unwrap(await ipc().org.shareMeeting(payload)).meeting,
    onSuccess: () => qc.invalidateQueries({ queryKey: orgKeys.meetings() }),
  });
}

/** Unshare a note. Adapter deletes the metadata + the S3 object atomically.
 *  Owner-only; the adapter 403s otherwise. */
export function useUnshareOrgMeeting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await ipc().org.deleteMeeting(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: orgKeys.meetings() }),
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
