const STORAGE_KEY = 'vora-backoffice-auth';

// Each SDK client owns one adapter. A retired client can finish revocation
// against its snapshot, but can never write to or delete a later login.
export function createAuthStorage(backing, key = STORAGE_KEY) {
  const memory = new Map(), snapshot = new Map();
  const keys = new Set([key, `${key}-user`, `${key}-code-verifier`]);
  let retired = false, pendingRemoval;
  const read = name => backing ? backing.getItem(name) : memory.get(name) ?? null;
  const remove = name => backing ? backing.removeItem(name) : memory.delete(name);
  return {
    getItem(name) { keys.add(name); return retired ? snapshot.get(name) ?? null : read(name); },
    setItem(name, value) {
      keys.add(name);
      if (!retired) { if (backing) backing.setItem(name, value); else memory.set(name, value); }
    },
    removeItem(name) { keys.add(name); if (retired) snapshot.delete(name); else remove(name); },
    retire() {
      if (!retired) {
        retired = true;
        pendingRemoval = new Set(keys);
        for (const name of keys) {
          try { const value = read(name); if (value !== null) snapshot.set(name, value); } catch {}
        }
      }
      let error = null;
      for (const name of pendingRemoval) {
        try { remove(name); pendingRemoval.delete(name); } catch (caught) { error ||= caught; }
      }
      return error;
    },
    clear() { snapshot.clear(); },
  };
}

// SIGNED_OUT received from another tab uses broadcast:false: never call
// signOut from that path or bounce the SDK's BroadcastChannel notification.
export async function finishAuthLogout(auth, storage, { broadcast = true, signedOut = () => false } = {}) {
  const storageError = storage.retire();
  if (!broadcast) storage.clear();
  let error = null;
  try {
    await auth.stopAutoRefresh();
    if (broadcast) {
      try { ({ error } = await auth.signOut({ scope: 'local' })); }
      catch (caught) { error = caught; }
      // An expired/offline session may resolve with an error before the SDK
      // removes it. The empty snapshot lets the SDK notify sibling tabs without
      // another token refresh or server request, even in that failure case.
      storage.clear();
      if (!signedOut()) {
        try { const result = await auth.signOut({ scope: 'local' }); error ||= result.error; }
        catch (caught) { error ||= caught; }
      }
    }
  } finally {
    storage.clear();
    await auth.dispose();
  }
  return { error, storageError };
}
