import type {
  Counts,
  ImageCreateResponse,
  NoteCreate,
  PostCreate,
  PostPatch,
  PostStatus,
  ResourcePatch,
  ResourceType,
  SettingsPatch,
} from '@perch/core';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { api, ApiError, type JsonResponse, unwrap } from './api';

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
    mutationFn: (token: string) =>
      unwrap(api.api.auth.login.$post({ json: { token } })),
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
    mutationFn: (patch: SettingsPatch) =>
      unwrap(api.api.settings.$patch({ json: patch })),
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
  sort?: 'created' | 'used';
  order: 'asc' | 'desc';
}

export const RESOURCES_PAGE_SIZE = 30;

export function useResources(
  filters: ResourceFilters,
  pageSize = RESOURCES_PAGE_SIZE,
) {
  return useInfiniteQuery({
    queryKey: ['resources', 'list', filters, pageSize],
    queryFn: ({ pageParam }) =>
      unwrap(
        api.api.resources.$get({
          query: {
            ...(filters.type !== undefined ? { type: filters.type } : {}),
            ...(filters.search !== undefined ? { search: filters.search } : {}),
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

export function useResource(id: number | null) {
  return useQuery({
    queryKey: ['resources', 'detail', id],
    queryFn: () =>
      unwrap(
        api.api.resources[':id'].$get({ param: { id: String(id) } }),
      ),
    enabled: id !== null,
  });
}

export function useCreateNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NoteCreate) =>
      unwrap(api.api.resources.notes.$post({ json: input })),
    onSuccess: (data) => {
      queryClient.setQueryData(['resources', 'detail', data.id], data);
      void queryClient.invalidateQueries({ queryKey: ['resources', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['counts'] });
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
    mutationFn: (ids: number[]) =>
      unwrap(api.api.resources.$delete({ json: { ids } })),
    onSuccess: (data) => {
      for (const result of data.results) {
        if (result.ok) {
          void queryClient
            .invalidateQueries({
              queryKey: ['resources', 'detail', result.id],
              refetchType: 'none',
            })
            .catch(() => undefined);
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['resources', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['counts'] });
    },
  });
}

export interface PostFilters {
  status?: PostStatus;
  search?: string;
  resource_id?: number;
}

export const POSTS_PAGE_SIZE = 50;

export function usePosts(filters: PostFilters) {
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
            limit: String(POSTS_PAGE_SIZE),
            ...(pageParam !== undefined ? { cursor: pageParam } : {}),
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

export function usePost(id: number | null) {
  return useQuery({
    queryKey: ['posts', 'detail', id],
    queryFn: () =>
      unwrap(api.api.posts[':id'].$get({ param: { id: String(id) } })),
    enabled: id !== null,
  });
}

export function useCreatePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PostCreate) =>
      unwrap(api.api.posts.$post({ json: input })),
    onSuccess: (data) => {
      queryClient.setQueryData(['posts', 'detail', data.id], data);
      void queryClient.invalidateQueries({ queryKey: ['posts', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['counts'] });
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
      unwrap(
        api.api.posts[':id'].$patch({ param: { id: String(id) }, json: patch }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(['posts', 'detail', data.id], data);
      void queryClient.invalidateQueries({ queryKey: ['posts', 'list'] });
    },
  });
}

export function useDeletePosts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) =>
      unwrap(api.api.posts.$delete({ json: { ids } })),
    onSuccess: (data) => {
      for (const result of data.results) {
        if (result.ok) {
          void queryClient
            .invalidateQueries({
              queryKey: ['posts', 'detail', result.id],
              refetchType: 'none',
            })
            .catch(() => undefined);
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['posts', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['counts'] });
      void queryClient.invalidateQueries({ queryKey: ['resources', 'list'] });
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

export function useCounts(): { posts: number; resources: number } {
  const me = useMe();
  const query = useQuery({
    queryKey: ['counts'],
    queryFn: () => unwrap(api.api.counts.$get()) as Promise<Counts>,
    enabled: me.data != null,
  });
  return query.data ?? { posts: 0, resources: 0 };
}
