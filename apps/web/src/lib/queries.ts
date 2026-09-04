import type {
  NoteCreate,
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

import { api, ApiError, unwrap } from './api';

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
    },
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) =>
      unwrap(api.api.settings.$patch({ json: patch })),
    onSuccess: (data) => queryClient.setQueryData(['settings'], data),
  });
}

export interface ResourceFilters {
  type?: ResourceType;
  search?: string;
  order: 'asc' | 'desc';
}

export const RESOURCES_PAGE_SIZE = 30;

export function useResources(filters: ResourceFilters) {
  return useInfiniteQuery({
    queryKey: ['resources', 'list', filters],
    queryFn: ({ pageParam }) =>
      unwrap(
        api.api.resources.$get({
          query: {
            ...(filters.type !== undefined ? { type: filters.type } : {}),
            ...(filters.search !== undefined ? { search: filters.search } : {}),
            sort: 'created',
            order: filters.order,
            limit: String(RESOURCES_PAGE_SIZE),
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
          queryClient.removeQueries({
            queryKey: ['resources', 'detail', result.id],
          });
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['resources', 'list'] });
    },
  });
}

export function useCounts(): { posts: number; resources: number } {
  // Replaced by real counts in #3/#7.
  return { posts: 0, resources: 0 };
}
