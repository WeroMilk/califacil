import { dashboardAuthJsonHeaders } from '@/lib/supabaseRouteAuth';
import {
  namesToImportResult,
  parseStudentNamesFromCsvFile,
  parseStudentNamesFromXlsxArrayBuffer,
  type StudentImportResult,
} from '@/lib/studentImportCore';

export type { ImportedStudent, StudentImportResult } from '@/lib/studentImportCore';
export { parseItsonAttendanceListText } from '@/lib/studentImportCore';

async function parseStudentImportFromPdfViaApi(file: File): Promise<StudentImportResult> {
  const authHeaders = await dashboardAuthJsonHeaders();
  const headers: Record<string, string> = {};
  const auth = (authHeaders as Record<string, string>).Authorization;
  if (auth) headers.Authorization = auth;

  const form = new FormData();
  form.append('file', file);

  const res = await fetch('/api/students/parse-import', {
    method: 'POST',
    headers,
    body: form,
  });

  const payload = (await res.json().catch(() => ({}))) as StudentImportResult & { error?: string };
  if (!res.ok) {
    throw new Error(payload.error || 'No se pudo leer el PDF');
  }
  return payload;
}

export async function parseStudentImportFile(file: File): Promise<StudentImportResult> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.pdf')) {
    return parseStudentImportFromPdfViaApi(file);
  }
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const buf = await file.arrayBuffer();
    const names = parseStudentNamesFromXlsxArrayBuffer(buf);
    return namesToImportResult(names, 'xlsx');
  }
  const names = await parseStudentNamesFromCsvFile(file);
  return namesToImportResult(names, 'csv');
}

/** CSV, Excel (`.xlsx` / `.xls`) o PDF con lista de alumnos. */
export async function parseStudentNamesFromImportFile(file: File): Promise<string[]> {
  const parsed = await parseStudentImportFile(file);
  return parsed.students.map((s) => s.name);
}
