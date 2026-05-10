import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ipc } from '@/lib/ipc';
import { unwrap } from '@/lib/result';
import type {
  OrgCreateMeetingPayload,
  OrgChatPayload,
  OrgMeeting,
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

/** Fetches the body of a shared note. If the meeting was registered with
 *  an inline body (legacy), returns that. Otherwise GETs the presigned S3
 *  URL the adapter handed back. Cached in memory only — never written to
 *  disk, which is the security pitch. */
export function useOrgMeetingBody(meeting: OrgMeeting | undefined) {
  return useQuery({
    queryKey: ['org', 'meeting-body', meeting?.id, meeting?.download_url],
    enabled: !!meeting,
    staleTime: 60_000,
    queryFn: async () => {
      if (!meeting) return '';
      if (meeting.body && meeting.body.length > 0) return meeting.body;
      if (meeting.download_url) {
        const r = await fetch(meeting.download_url);
        if (!r.ok) throw new Error(`s3 fetch failed: ${r.status}`);
        return r.text();
      }
      return '';
    },
  });
}

export function useOrgAiChat() {
  return useMutation({
    mutationFn: async (payload: OrgChatPayload) =>
      unwrap(await ipc().org.aiChat(payload)),
  });
}
