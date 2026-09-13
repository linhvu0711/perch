import type {
  Counts,
  ImageCreateResponse,
  NoteCreate,
  PostCreate,
  PostMediaDetachBody,
  PostMediaFilesResponse,
  PostPatch,
  PostStatus,
  ResourcePatch,
  ResourceType,
  SettingsPatch,
  TweetCreate,
} from '@perch/core';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { ApiError, api, type JsonResponse, unwrap } from './api';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await unwrap(api.api.auth.me.$get());
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
  });
}

export function useSettings() {
  const me = useMe();
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => unwrap(api.api.settings.$get()),
    enabled: me.data != null,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => unwrap(api.api.auth.login.$post({ json: { token } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.api.auth.logout.$post()),
    onSuccess: () => {
      queryClient.setQueryData(['me'], null);
      queryClient.removeQueries({ queryKey: ['settings'] });
      queryClient.removeQueries({ queryKey: ['account'] });
    },
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => unwrap(api.api.settings.$patch({ json: patch })),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
      void queryClient.invalidateQueries({ queryKey: ['account'] });
    },
  });
}

export function useAccount() {
  const me = useMe();
  return useQuery({
    queryKey: ['account'],
    queryFn: () => unwrap(api.api.account.$get()),
    enabled: me.data != null,
  });
}

export function useConnectX() {
  return useMutation({
    mutationFn: () => unwrap(api.api.account.connect.$post()),
  });
}

export function useDisconnectX() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.api.account.disconnect.$post()),
    onSuccess: (data) => {
      queryClient.setQueryData(['account'], data);
    },
  });
}

export interface ResourceFilters {
  type?: ResourceType;
  search?: string;
  author?: string;
  tag?: string[];
  sort?: 'created' | 'used';
  order: 'asc' | 'desc';
}

export const RESOURCES_PAGE_SIZE = 30;

export function useResources(filters: ResourceFilters, pageSize = RESOURCES_PAGE_SIZE) {
  return useInfiniteQuery({
    queryKey: ['resources', 'list', filters, pageSize],
    queryFn: ({ pageParam }) =>
      unwrap(
        api.api.resources.$get({
          query: {
            ...(filters.type !== undefined ? { type: filters.type } : {}),
            ...(filters.search !== undefined ? { search: filters.search } : {}),
            ...(filters.author !== undefined ? { author: filters.author } : {}),
            ...(filters.tag !== undefined ? { tag: filters.tag } : {}),
            sort: filters.sort ?? 'created',
            order: filters.order,
            limit: String(pageSize),
            ...(pageParam !== undefined ? { cursor: pageParam } : {}),
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

export function useResourceAuthors() {
  return useQuery({
    queryKey: ['resources', 'authors'],
    queryFn: () => unwrap(api.api.resources.authors.$get()),
  });
}

export function useSaveTweets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TweetCreate) => unwrap(api.api.resources.tweets.$post({ json: input })),
    onSuccess: (data) => {
      for (const result of data.results) {
        if (result.ok) {
          queryClient.setQueryData(['resources', 'detail', result.resource.id], result.resource);
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['resources', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['resources', 'authors'] });
      void queryClient.invalidateQueries({ queryKey: ['counts'] });
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useResource(id: number | null) {
  return useQuery({
    queryKey: ['resources', 'detail', id],
    queryFn: () => unwrap(api.api.resources[':id'].$get({ param: { id: String(id) } })),
    enabled: id !== null,
  });
}

export function useCreateNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NoteCreate) => unwrap(api.api.resources.notes.$post({ json: input })),
    onSuccess: (data) => {
      queryClient.setQueryData(['resources', 'detail', data.id], data);
      void queryClient.invalidateQueries({ queryKey: ['resources', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['counts'] });
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useUploadImages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]) => {
      const form = new FormData();
      for (const file of files) form.append('files', file);
      return unwrap(
        fetch('/api/resources/images', {
          method: 'POST',
          body: form,
          credentials: 'same-origin',
        }) as Promise<JsonResponse<ImageCreateResponse>>,
      );
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['resources'] });
      if (data.results.some((result) => result.ok)) {
        void queryClient.invalidateQueries({ queryKey: ['counts'] });
        void queryClient.invalidateQueries({ queryKey: ['tags'] });
      }
    },
  });
}

export function useUpdateResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: ResourcePatch }) =>
      unwrap(
        api.api.resources[':id'].$patch({
          param: { id: String(id) },
          json: patch,
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(['resources', 'detail', data.id], data);
      void queryClient.invalidateQueries({ queryKey: ['resources', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['counts'] });
    },
  });
}

export function useDeleteResources() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => unwrap(api.api.resources.$delete({ json: { ids } })),
    onSuccess: (data) => {
      for (const result of data.results) {
        if (result.ok) {
          void queryClient
            .invalidateQueries({
              queryKey: ['resources', 'detail', result.id],
              refetchType: 'none',
            })
            // A dropped invalidation leaves stale detail data that refetches
            // (and 404-redirects) on next view, so silence is acceptable here.
            .catch(() => undefined);
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['resources', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['resources', 'authors'] });
      void queryClient.invalidateQueries({ queryKey: ['counts'] });
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export interface PostFilters {
  status?: PostStatus;
  search?: string;
  resource_id?: number;
  tag?: string[];
  scheduled?: boolean;
  needs_attention?: boolean;
}

export const POSTS_PAGE_SIZE = 50;

export function usePosts(filters: PostFilters, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['posts', 'list', filters],
    queryFn: ({ pageParam }) =>
      unwrap(
        api.api.posts.$get({
          query: {
            ...(filters.status !== undefined ? { status: filters.status } : {}),
            ...(filters.search !== undefined ? { search: filters.search } : {}),
            ...(filters.resource_id !== undefined
              ? { resource_id: String(filters.resource_id) }
              : {}),
            ...(filters.tag !== undefined ? { tag: filters.tag } : {}),
            ...(filters.scheduled !== undefined
              ? { scheduled: filters.scheduled ? ('true' as const) : ('false' as const) }
              : {}),
            ...(filters.needs_attention === true ? { needs_attention: 'true' as const } : {}),
            limit: String(POSTS_PAGE_SIZE),
            ...(pageParam !== undefined ? { cursor: pageParam } : {}),
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    // missed/published rows change with the scheduler clock, so poll on the tick cadence
    refetchInterval: 30_000,
    enabled,
  });
}

export interface CalendarFilters {
  from: string;
  to: string;
  tag?: string[];
}

export function useCalendar(filters: CalendarFilters) {
  return useQuery({
    queryKey: ['posts', 'list', 'calendar', filters],
    queryFn: () =>
      unwrap(
        api.api.calendar.$get({
          query: {
            from: filters.from,
            to: filters.to,
            ...(filters.tag !== undefined ? { tag: filters.tag } : {}),
          },
        }),
      ),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
}

export function useStatus() {
  const me = useMe();
  return useQuery({
    queryKey: ['posts', 'list', 'status'],
    queryFn: () => unwrap(api.api.status.$get()),
    refetchInterval: 30_000,
    enabled: me.data != null,
  });
}

export function usePost(id: number | null) {
  return useQuery({
    queryKey: ['posts', 'detail', id],
    queryFn: () => unwrap(api.api.posts[':id'].$get({ param: { id: String(id) } })),
    // same cadence as the list poll so an open modal sees scheduler transitions
    refetchInterval: 30_000,
    enabled: id !== null,
  });
}

export function useCreatePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PostCreate) => unwrap(api.api.posts.$post({ json: input })),
    onSuccess: (data) => {
      queryClient.setQueryData(['posts', 'detail', data.id], data);
      void queryClient.invalidateQueries({ queryKey: ['posts', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['counts'] });
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
      if (data.links.length > 0) {
        void queryClient.invalidateQueries({ queryKey: ['resources', 'list'] });
      }
    },
  });
}

export function useUpdatePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: PostPatch }) =>
      unwrap(api.api.posts[':id'].$patch({ param: { id: String(id) }, json: patch })),
    onSuccess: (data) => {
      queryClient.setQueryData(['posts', 'detail', data.id], data);
      void queryClient.invalidateQueries({ queryKey: ['posts', 'list'] });
    },
  });
}

export function useDeletePosts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => unwrap(api.api.posts.$delete({ json: { ids } })),
    onSuccess: (data) => {
      for (const result of data.results) {
        if (result.ok) {
          void queryClient
            .invalidateQueries({
              queryKey: ['posts', 'detail', result.id],
              refetchType: 'none',
            })
            // Same tradeoff as resource detail: a missed invalidation surfaces
            // as a one-time 404 redirect on next view.
            .catch(() => undefined);
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['posts', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['counts'] });
      void queryClient.invalidateQueries({ queryKey: ['resources', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function usePromotePosts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => unwrap(api.api.posts.promote.$post({ json: { ids } })),
    onSuccess: (data) => {
      for (const result of data.results) {
        if (result.ok) {
          void queryClient.invalidateQueries({ queryKey: ['posts', 'detail', result.id] });
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['posts', 'list'] });
    },
  });
}

export function useDemotePosts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => unwrap(api.api.posts.demote.$post({ json: { ids } })),
    onSuccess: (data) => {
      for (const result of data.results) {
        if (result.ok) {
          void queryClient.invalidateQueries({ queryKey: ['posts', 'detail', result.id] });
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['posts', 'list'] });
    },
  });
}

export function useDismissPosts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => unwrap(api.api.posts.dismiss.$post({ json: { ids } })),
    onSuccess: (data) => {
      for (const result of data.results) {
        if (result.ok) {
          void queryClient.invalidateQueries({ queryKey: ['posts', 'detail', result.id] });
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['posts', 'list'] });
    },
  });
}

export function useUnschedulePosts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => unwrap(api.api.posts.unschedule.$post({ json: { ids } })),
    onSuccess: (data) => {
      for (const result of data.results) {
        if (result.ok) {
          void queryClient.invalidateQueries({ queryKey: ['posts', 'detail', result.id] });
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['posts', 'list'] });
    },
  });
}

export function useSchedulePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, at }: { id: number; at: string }) =>
      unwrap(api.api.posts[':id'].schedule.$post({ param: { id: String(id) }, json: { at } })),
    onSuccess: (data) => {
      queryClient.setQueryData(['posts', 'detail', data.id], data);
      void queryClient.invalidateQueries({ queryKey: ['posts', 'list'] });
    },
  });
}

export function usePublishPost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      unwrap(api.api.posts[':id'].publish.$post({ param: { id: String(id) } })),
    onSuccess: (data) => {
      queryClient.setQueryData(['posts', 'detail', data.id], data);
      void queryClient.invalidateQueries({ queryKey: ['posts', 'list'] });
    },
    onError: (_error, id) => {
      void queryClient.invalidateQueries({ queryKey: ['posts', 'detail', id] });
    },
  });
}

export function useRetryPost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      unwrap(api.api.posts[':id'].retry.$post({ param: { id: String(id) } })),
    onSuccess: (data) => {
      queryClient.setQueryData(['posts', 'detail', data.id], data);
      void queryClient.invalidateQueries({ queryKey: ['posts', 'list'] });
    },
    onError: (_error, id) => {
      void queryClient.invalidateQueries({ queryKey: ['posts', 'detail', id] });
    },
  });
}

export function useLinkResources() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resource_ids }: { id: number; resource_ids: number[] }) =>
      unwrap(
        api.api.posts[':id'].links.$post({
          param: { id: String(id) },
          json: { resource_ids },
        }),
      ),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: ['posts', 'detail', id] });
      void queryClient.invalidateQueries({ queryKey: ['posts', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['resources', 'list'] });
    },
  });
}

export function useUnlinkResources() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resource_ids }: { id: number; resource_ids: number[] }) =>
      unwrap(
        api.api.posts[':id'].links.$delete({
          param: { id: String(id) },
          json: { resource_ids },
        }),
      ),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: ['posts', 'detail', id] });
      void queryClient.invalidateQueries({ queryKey: ['posts', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['resources', 'list'] });
    },
  });
}

export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: () => unwrap(api.api.tags.$get()),
  });
}

export function useTagResources() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: number[]; tags: string[] }) =>
      unwrap(api.api.resources.tags.$post({ json: input })),
    onSuccess: (_data, { ids }) => {
      for (const id of ids) {
        void queryClient.invalidateQueries({ queryKey: ['resources', 'detail', id] });
      }
      void queryClient.invalidateQueries({ queryKey: ['resources', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useUntagResources() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: number[]; tags: string[] }) =>
      unwrap(api.api.resources.tags.$delete({ json: input })),
    onSuccess: (_data, { ids }) => {
      for (const id of ids) {
        void queryClient.invalidateQueries({ queryKey: ['resources', 'detail', id] });
      }
      void queryClient.invalidateQueries({ queryKey: ['resources', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useTagPosts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: number[]; tags: string[] }) =>
      unwrap(api.api.posts.tags.$post({ json: input })),
    onSuccess: (_data, { ids }) => {
      for (const id of ids) {
        void queryClient.invalidateQueries({ queryKey: ['posts', 'detail', id] });
      }
      void queryClient.invalidateQueries({ queryKey: ['posts', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useUntagPosts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: number[]; tags: string[] }) =>
      unwrap(api.api.posts.tags.$delete({ json: input })),
    onSuccess: (_data, { ids }) => {
      for (const id of ids) {
        void queryClient.invalidateQueries({ queryKey: ['posts', 'detail', id] });
      }
      void queryClient.invalidateQueries({ queryKey: ['posts', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => unwrap(api.api.tags.$post({ json: { name } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useRenameTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      unwrap(api.api.tags[':id'].$patch({ param: { id: String(id) }, json: { name } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
      void queryClient.invalidateQueries({ queryKey: ['resources'] });
      void queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
  });
}

export function useDeleteTags() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => unwrap(api.api.tags.$delete({ json: { ids } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
      void queryClient.invalidateQueries({ queryKey: ['resources'] });
      void queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
  });
}

export function useAttachMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resource_ids }: { id: number; resource_ids: number[] }) =>
      unwrap(
        api.api.posts[':id'].media.$post({
          param: { id: String(id) },
          json: { resource_ids },
        }),
      ),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: ['posts', 'detail', id] });
      void queryClient.invalidateQueries({ queryKey: ['posts', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['resources', 'list'] });
    },
  });
}

export function useAttachFiles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, files }: { id: number; files: File[] }) => {
      const form = new FormData();
      for (const file of files) form.append('files', file);
      return unwrap(
        fetch(`/api/posts/${id}/media/files`, {
          method: 'POST',
          body: form,
          credentials: 'same-origin',
        }) as Promise<JsonResponse<PostMediaFilesResponse>>,
      );
    },
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: ['posts', 'detail', id] });
      void queryClient.invalidateQueries({ queryKey: ['posts', 'list'] });
    },
  });
}

export function useDetachMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & PostMediaDetachBody) =>
      unwrap(
        api.api.posts[':id'].media.$delete({
          param: { id: String(id) },
          json: body,
        }),
      ),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: ['posts', 'detail', id] });
      void queryClient.invalidateQueries({ queryKey: ['posts', 'list'] });
    },
  });
}

export function useCounts(): { posts: number; resources: number } {
  const me = useMe();
  const query = useQuery({
    queryKey: ['counts'],
    queryFn: () => unwrap(api.api.counts.$get()) as Promise<Counts>,
    enabled: me.data != null,
  });
  return query.data ?? { posts: 0, resources: 0 };
}
