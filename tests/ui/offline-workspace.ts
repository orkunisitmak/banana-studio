// Use the production app/desktop client. Only the local JSON transport is
// replaced: synthetic rows live in this tab, and no generation route exists.
const userId = '00000000-0000-0000-0000-000000000001';
const sessionId = '00000000-0000-0000-0000-000000000002';
window.__BANANA_STUDIO_CONFIG__ = { mode: 'local', userId, sessionId };
const routes: Record<string, string> = {};
let text = { model: 'claude-opus-5.5', featureModels: {}, thinkingLevel: 'MEDIUM', reasoningEffort: 'medium', source: 'personal', canSaveAll: false, revision: 1 };
const ok = (data: unknown) => Response.json({ data, error: null });
window.fetch = async (input, init) => {
  switch (String(input)) {
    case '/api/workspace-config': return Response.json({ mode: 'local', userId, sessionId });
    case '/api/gemini-status': return Response.json({ configured: true, providers: { fal: true, evolink: true, openai: true, openrouter: true, anthropic: false, gemini: false, codex: false } });
    case '/local/query': {
      const { rpc, args, operation, table, single } = JSON.parse(String(init?.body));
      if (rpc === 'get_provider_preferences') return ok(routes);
      if (rpc === 'save_provider_preference' && args.p_expected_user_id === userId) {
        routes[args.p_model] = args.p_provider;
        return ok(true);
      }
      if (rpc === 'get_text_model_preferences') return ok(text);
      if (rpc === 'save_text_model_preferences' && args.p_expected_user_id === userId) {
        text = { ...text, model: args.p_model, thinkingLevel: args.p_gemini_thinking, reasoningEffort: args.p_openai_reasoning,
          featureModels: args.p_feature_models || {}, revision: text.revision + 1 };
        return ok(text);
      }
      if (rpc === 'get_gallery_search_people') return ok([]);
      if (operation === 'select') {
        if (table === 'authorized_emails') return ok({ email: 'local@example.invalid' });
        if (table === 'profiles') return ok({ id: userId, role: 'user', display_name: 'Offline fixture' });
        return ok(single ? null : []);
      }
    }
  }
  throw new Error('Offline fixture: uploads, generation and external requests are disabled.');
};
export {};
