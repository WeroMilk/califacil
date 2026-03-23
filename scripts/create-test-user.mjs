/**
 * Crea un usuario maestro de prueba en Supabase Auth.
 *
 * Requiere la clave service_role (solo en servidor / local, nunca en el cliente).
 *
 * PowerShell:
 *   $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."
 *   npm run create-test-user
 *
 * Opcional: TEST_EMAIL, TEST_PASSWORD
 */

import { createClient } from '@supabase/supabase-js';

const url =
  process.env.SUPABASE_URL?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const email = process.env.TEST_EMAIL?.trim() || 'profesor.prueba@califacil.test';
const password = process.env.TEST_PASSWORD?.trim() || 'CalifacilPrueba2025!';

if (!url || !serviceKey) {
  console.error(
    'Configura SUPABASE_SERVICE_ROLE_KEY y SUPABASE_URL o NEXT_PUBLIC_SUPABASE_URL.\n' +
      'La service role está en Supabase → Project Settings → API (secreto).'
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { role: 'teacher' },
});

if (error) {
  const msg = error.message || '';
  if (
    msg.toLowerCase().includes('already') ||
    msg.toLowerCase().includes('registered') ||
    error.code === 'email_exists'
  ) {
    console.log('Ya existe un usuario con ese email:', email);
    console.log('Puedes iniciar sesión con la contraseña que definiste al crearlo.');
    process.exit(0);
  }
  console.error('Error:', error);
  process.exit(1);
}

console.log('Usuario de prueba creado.');
console.log('  Email:   ', email);
console.log('  Password:', password);
console.log('  Id:      ', data.user?.id);
