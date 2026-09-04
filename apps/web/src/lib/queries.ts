import type { Me, Settings, SettingsPatch } from '@perch/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, ApiError, unwrap } from './api';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await unwrap<Me>(
          api.api.auth.me.$get() as unknown as Promise<Response>,
        );
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
    queryFn: () =>
      unwrap<Settings>(
        api.api.settings.$get() as unknown as Promise<Response>,
      ),
    enabled: me.data != null,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      unwrap<Me>(
        api.api.auth.login.$post({ json: { token } }) as unknown as Promise<Response>,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap<{ ok: true }>(
        api.api.auth.logout.$post() as unknown as Promise<Response>,
      ),
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
      unwrap<Settings>(
        api.api.settings.$patch({ json: patch }) as unknown as Promise<Response>,
      ),
    onSuccess: (data) => queryClient.setQueryData(['settings'], data),
  });
}

export function useCounts(): { posts: number; resources: number } {
  // Replaced by real counts in #3/#7.
  return { posts: 0, resources: 0 };
}
