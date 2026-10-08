import { config } from '/crm-config.js';
import { createAuthStorage, finishAuthLogout } from '/crm-auth-session.js';
const KEY = 'vora-crm-auth';
export function createAuth(onChange) {
  let backing;
  try {
    backing = window.sessionStorage;
  } catch {}
  const storage = createAuthStorage(backing, KEY);
  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
    auth: {
      storage,
      storageKey: KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });
  let retiring = false,
    signedOut = false;
  const {
    data: {
      subscription
    }
  } = client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') signedOut = true;
    if (!retiring) setTimeout(() => onChange(event, session), 0);
  });
  return {
    client,
    storage,
    async logout(broadcast = true) {
      if (retiring) return;
      retiring = true;
      try {
        return await finishAuthLogout(client.auth, storage, {
          broadcast,
          signedOut: () => signedOut
        });
      } finally {
        subscription.unsubscribe();
      }
    },
    isRetired: () => retiring
  };
}
