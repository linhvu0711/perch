import type { Post } from '@perch/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { toast } from '@/components/Toast';
import { errorMessage } from '@/lib/api';
import { useCreatePost, usePost, useUpdatePost } from '@/lib/queries';

export interface PostEditor {
  post: Post | undefined;
  isPending: boolean;
  error: Error | null;
  title: string;
  text: string;
  setTitle(title: string): void;
  setText(text: string): void;
  ensureId(): Promise<number | null>;
  close(): void;
}

export function usePostEditor(id: number | null): PostEditor {
  const navigate = useNavigate();
  const postQuery = usePost(id);
  const createPost = useCreatePost();
  const updatePost = useUpdatePost();
  const timerRef = useRef<number>(undefined);
  const closedRef = useRef(false);
  const savedRef = useRef(false);
  const pendingRef = useRef<{ title?: string; text?: string }>({});
  const [drafts, setDrafts] = useState<{ title: string; text: string } | null>(null);

  const post = postQuery.data;
  const currentId = post?.id;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the post changes
  useEffect(() => {
    setDrafts(null);
    savedRef.current = false;
  }, [currentId]);

  const createRef = useRef<Promise<Post> | null>(null);

  const ensureCreated = useCallback((): Promise<Post> => {
    createRef.current ??= createPost
      .mutateAsync({})
      .then((created) => {
        savedRef.current = true;
        if (!closedRef.current) {
          navigate(`../${created.id}`, { replace: true });
        }
        return created;
      })
      .catch((error: unknown) => {
        createRef.current = null;
        throw error;
      });
    return createRef.current;
  }, [createPost, navigate]);

  const queueRef = useRef<Promise<boolean>>(Promise.resolve(true));

  const flush = useCallback((): Promise<boolean> => {
    queueRef.current = queueRef.current.then(async () => {
      const patch = pendingRef.current;
      const hasChanges = patch.title !== undefined || patch.text !== undefined;
      pendingRef.current = {};
      let postId = currentId;
      if (postId === undefined) {
        if (!hasChanges && createRef.current === null) return true;
        try {
          postId = (await ensureCreated()).id;
        } catch (error) {
          pendingRef.current = { ...patch, ...pendingRef.current };
          toast(errorMessage(error), 'warn');
          return false;
        }
      }
      if (!hasChanges) return true;
      try {
        await updatePost.mutateAsync({ id: postId, patch });
        savedRef.current = true;
        return true;
      } catch (error) {
        pendingRef.current = { ...patch, ...pendingRef.current };
        toast(errorMessage(error), 'warn');
        return false;
      }
    });
    return queueRef.current;
  }, [currentId, ensureCreated, updatePost]);

  const drain = useCallback(async (): Promise<boolean> => {
    let ok = await flush();
    while (
      ok &&
      (pendingRef.current.title !== undefined || pendingRef.current.text !== undefined)
    ) {
      ok = await flush();
    }
    return ok;
  }, [flush]);

  const close = useCallback(() => {
    closedRef.current = true;
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    void (async () => {
      const ok = await drain();
      if (!ok) {
        closedRef.current = false;
        return;
      }
      if (savedRef.current) toast('Saved');
      navigate('..');
    })().catch((error: unknown) => {
      closedRef.current = false;
      toast(errorMessage(error), 'warn');
    });
  }, [drain, navigate]);

  const scheduleSave = useCallback(
    (patch: { title?: string; text?: string }) => {
      pendingRef.current = { ...pendingRef.current, ...patch };
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void flush(), 600);
    },
    [flush],
  );

  const ensureId = useCallback(async (): Promise<number | null> => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    const ok = await drain();
    if (!ok) return null;
    if (currentId !== undefined) return currentId;
    try {
      return (await ensureCreated()).id;
    } catch (error) {
      toast(errorMessage(error), 'warn');
      return null;
    }
  }, [currentId, drain, ensureCreated]);

  const setTitle = useCallback(
    (title: string) => {
      setDrafts((prev) => ({ title, text: prev?.text ?? post?.text ?? '' }));
      scheduleSave({ title });
    },
    [post?.text, scheduleSave],
  );

  const setText = useCallback(
    (text: string) => {
      setDrafts((prev) => ({ title: prev?.title ?? post?.title ?? '', text }));
      scheduleSave({ text });
    },
    [post?.title, scheduleSave],
  );

  return {
    post: postQuery.data,
    isPending: postQuery.isPending,
    error: postQuery.error,
    title: drafts?.title ?? post?.title ?? '',
    text: drafts?.text ?? post?.text ?? '',
    setTitle,
    setText,
    ensureId,
    close,
  };
}
