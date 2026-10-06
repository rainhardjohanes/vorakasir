// Identity generations, separate from routes, invalidate A → B → A responses.
export function identityGuard() {
  let userId = null, epoch = 0;
  return {
    set(id, force = false) { if (force || id !== userId) { epoch++; userId = id; } },
    capture() { const version = epoch, id = userId; return () => epoch === version && userId === id; },
    get id() { return userId; },
  };
}

export function validatePublicConfig(config) {
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(config.supabaseUrl) || typeof config.supabaseKey !== 'string') throw new Error('Konfigurasi Supabase tidak valid.');
  if (config.supabaseKey.startsWith('sb_publishable_')) return;
  let role;
  try { role = JSON.parse(atob(config.supabaseKey.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))).role; } catch {}
  if (role !== 'anon') throw new Error('Dashboard hanya boleh memakai public key.');
}

export async function boundedFetch(url, options = {}) {
  const controller = new AbortController(), abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 25000);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
