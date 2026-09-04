import type { SettingsPatch } from '@perch/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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
    onSuccess: async () => {
      queryClient.clear();
      await queryClient.invalidateQueries({ queryKey: ['me'] });
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

export function useCounts(): { posts: number; resources: number } {
  // Replaced by real counts in #3/#7.
  return { posts: 0, resources: 0 };
}
