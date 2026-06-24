'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ExamFolder } from '@/types';

export function useExamFolders(teacherId: string | undefined) {
  const [folders, setFolders] = useState<ExamFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFolders = useCallback(async () => {
    if (!teacherId) return;

    try {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('exam_folders')
        .select('*')
        .eq('teacher_id', teacherId)
        .order('name', { ascending: true });

      if (fetchError) throw fetchError;
      setFolders(data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al cargar carpetas');
    } finally {
      setLoading(false);
    }
  }, [teacherId]);

  useEffect(() => {
    void fetchFolders();
  }, [fetchFolders]);

  const createFolder = async (
    name: string,
    parentId: string | null
  ): Promise<{ folder: ExamFolder | null; error: string | null }> => {
    if (!teacherId) return { folder: null, error: 'Sesión no válida' };
    const trimmed = name.trim();
    if (!trimmed) return { folder: null, error: 'El nombre está vacío' };

    const { data, error: insertError } = await supabase
      .from('exam_folders')
      .insert([{ teacher_id: teacherId, parent_id: parentId, name: trimmed }])
      .select()
      .single();

    if (insertError) {
      const message = insertError.message || 'Error al crear carpeta';
      setError(message);
      console.error('createFolder:', insertError);
      return { folder: null, error: message };
    }

    setFolders((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name, 'es')));
    return { folder: data, error: null };
  };

  const renameFolder = async (folderId: string, name: string): Promise<boolean> => {
    const trimmed = name.trim();
    if (!trimmed) return false;

    try {
      const { error: updateError } = await supabase
        .from('exam_folders')
        .update({ name: trimmed })
        .eq('id', folderId);

      if (updateError) throw updateError;
      setFolders((prev) =>
        prev
          .map((f) => (f.id === folderId ? { ...f, name: trimmed } : f))
          .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      );
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al renombrar carpeta');
      return false;
    }
  };

  const deleteFolder = async (folderId: string): Promise<boolean> => {
    try {
      const { error: deleteError } = await supabase.from('exam_folders').delete().eq('id', folderId);
      if (deleteError) throw deleteError;
      await fetchFolders();
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al eliminar carpeta');
      return false;
    }
  };

  return {
    folders,
    loading,
    error,
    createFolder,
    renameFolder,
    deleteFolder,
    refreshFolders: fetchFolders,
  };
}

/** Ruta desde la raíz hasta la carpeta indicada (incluida). */
export function buildExamFolderPath(
  folders: ExamFolder[],
  folderId: string | null
): ExamFolder[] {
  if (!folderId) return [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: ExamFolder[] = [];
  let current = byId.get(folderId) ?? null;
  while (current) {
    path.unshift(current);
    current = current.parent_id ? (byId.get(current.parent_id) ?? null) : null;
  }
  return path;
}
