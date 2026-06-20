import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { supabase as supabaseBrowser } from '@/lib/supabase';

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || 'http://127.0.0.1:54321';
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
  '00000000-0000-0000-0000-000000000000';

/** Cliente Supabase autenticado con JWT del maestro (RLS + RPC con auth.uid()). */
export function createSupabaseRouteClientForJwt(jwt: string) {
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    },
  });
}

export function createSupabaseRouteClient(request: NextRequest) {
  const auth = request.headers.get('Authorization')?.trim();
  const jwt = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  if (!jwt) {
    return createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return createSupabaseRouteClientForJwt(jwt);
}

/** Sesión válida; la propiedad del recurso (p. ej. exam.teacher_id) define permisos. */
export async function requireSessionUser(request: NextRequest): Promise<
  | {
      user: { id: string; email: string | undefined };
      supabase: ReturnType<typeof createSupabaseRouteClientForJwt>;
    }
  | { response: NextResponse }
> {
  const auth = request.headers.get('Authorization')?.trim();
  if (!auth?.startsWith('Bearer ')) {
    return { response: NextResponse.json({ error: 'No autorizado' }, { status: 401 }) };
  }

  const jwt = auth.slice('Bearer '.length);
  const supabase = createSupabaseRouteClientForJwt(jwt);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(jwt);

  if (error || !user) {
    return { response: NextResponse.json({ error: 'Sesión inválida' }, { status: 401 }) };
  }

  return { user: { id: user.id, email: user.email ?? undefined }, supabase };
}

/** Headers para fetch desde el dashboard con la sesión actual. */
export async function dashboardAuthJsonHeaders(): Promise<HeadersInit> {
  const {
    data: { session },
  } = await supabaseBrowser.auth.getSession();

  let accessToken = session?.access_token;
  if (!accessToken) {
    const refreshed = await supabaseBrowser.auth.refreshSession();
    accessToken = refreshed.data.session?.access_token;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return headers;
}
