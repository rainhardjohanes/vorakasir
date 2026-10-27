// Customer data stays in memory. Every RPC enforces permissions on the server.
export function createApi(client) {
  let generation = 0;
  const pending = new Set();
  const cancel = () => {
    generation++;
    for (const c of pending) c.abort();
    pending.clear();
  };
  async function call(name, args = {}) {
    const epoch = generation,
      c = new AbortController();
    pending.add(c);
    try {
      const {
        data,
        error
      } = await client.rpc(name, args).abortSignal(c.signal);
      if (epoch !== generation) throw new DOMException('Request cancelled', 'AbortError');
      if (error) throw error;
      return data;
    } finally {
      pending.delete(c);
    }
  }
  async function demo(args) {
    const epoch = generation, c = new AbortController();
    pending.add(c);
    const timeout = setTimeout(() => c.abort(), 60000);
    try {
      const {data, error} = await client.functions.invoke('crm-demo-accounts', {body: args, signal: c.signal});
      if (epoch !== generation) throw new DOMException('Request cancelled', 'AbortError');
      if (error) {
        let body;
        try { body = await error.context?.json?.(); } catch { /* Only safe server codes leave this boundary. */ }
        if (epoch !== generation) throw new DOMException('Request cancelled', 'AbortError');
        throw Object.assign(new Error('Demo account request failed'), {code: body?.error_code || body?.error?.code || body?.code || error.code});
      }
      if (data?.error) throw Object.assign(new Error('Demo account request failed'), {code: data.error.code || data.code});
      return data;
    } finally { clearTimeout(timeout); pending.delete(c); }
  }
  return {
    cancel,
    demo,
    demos: (args = {}) => call('vora_crm_demo_accounts', args),
    session: () => call('vora_crm_session'),
    list: (args = {}) => call('vora_crm_list', args),
    activity: (args = {}) => call('vora_crm_list_activity', args),
    detail: id => call('vora_crm_detail', {
      p_merchant_id: id
    }),
    followup: args => call('vora_crm_followup', args),
    renew: args => call('vora_crm_renew', args),
    members: () => call('vora_crm_members'),
    saveMember: args => call('vora_crm_save_member', args),
    audit: (args = {}) => call('vora_crm_audit', args)
  };
}
