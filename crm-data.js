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
  return {
    cancel,
    session: () => call('vora_crm_session'),
    list: (args = {}) => call('vora_crm_list', args),
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
