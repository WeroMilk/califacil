-- Limpieza del flujo legado de hoja clave por foto del maestro.
-- Mantiene el esquema alineado con la clave automática por respuestas del examen.

-- 1) Quitar políticas legacy de storage para bucket obsoleto.
drop policy if exists exam_key_photos_owner_select on storage.objects;
drop policy if exists exam_key_photos_owner_insert on storage.objects;
drop policy if exists exam_key_photos_owner_update on storage.objects;
drop policy if exists exam_key_photos_owner_delete on storage.objects;

-- 2) Bucket legacy:
-- En algunos entornos de Supabase no existen funciones SQL públicas para vaciar/borrar bucket
-- (p. ej. storage.empty_bucket / storage.delete_bucket), y borrar storage.objects directo está bloqueado.
-- Por compatibilidad, este migration NO borra el bucket desde SQL.
-- Si quieres retirarlo, hazlo desde Storage API o desde el Dashboard.
do $$
begin
  if exists (select 1 from storage.buckets where id = 'exam-key-photos') then
    raise notice 'Bucket legacy "exam-key-photos" detectado. Se conserva por compatibilidad SQL.';
  end if;
end $$;

-- 3) Eliminar tabla de metadata de imágenes legacy.
drop table if exists public.exam_key_images;

-- 4) Retirar columnas legacy en exams.
alter table public.exams
  drop column if exists answer_key_source,
  drop column if exists answer_key_by_question;
