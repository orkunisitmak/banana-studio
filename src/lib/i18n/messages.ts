// The isolated language-context/switcher idea was reviewed from PR #31
// (thundergokhan, 9f3cfaa3c0c3bb563d0bedc1cb86a7906d741b4b).
// Other product features and changes from that mixed PR are not included here.
export const messages = {
  en: {
    localWorkspace: 'Local workspace · This computer', workspace: 'Your workspace',
    aiSettings: 'AI settings', admin: 'Workspace admin', signOut: 'Sign out', providerKeys: 'Provider keys',
    closeSettings: 'Close AI settings', language: 'Interface language', history: 'History', close: 'Close',
    generateImage: 'Generate image', enhanceRequired: 'Re-enhance required', brainstorm: 'Brainstorm ideas',
    closeBrainstorm: 'Close Brainstorm', templates: 'Templates', templateName: 'Template name…',
    saveSettings: 'Save current settings', updateSettings: 'Update with current settings', delete: 'Delete',
    imageGeneration: 'Image generation', action: 'Action', preparing: 'Preparing…',
    welcome: 'Welcome, {name}', savingLanguage: 'Saving language…', languageSaveError: 'Language changed for this session, but could not be saved. Retry', retryLanguage: 'Retry language save',
  },
  tr: {
    localWorkspace: 'Yerel çalışma alanı · Bu bilgisayar', workspace: 'Çalışma alanın',
    aiSettings: 'Yapay zekâ ayarları', admin: 'Çalışma alanı yönetimi', signOut: 'Çıkış yap', providerKeys: 'Sağlayıcı anahtarları',
    closeSettings: 'Yapay zekâ ayarlarını kapat', language: 'Arayüz dili', history: 'Geçmiş', close: 'Kapat',
    generateImage: 'Görsel üret', enhanceRequired: 'İstemi yeniden iyileştir', brainstorm: 'Fikir üret',
    closeBrainstorm: 'Fikir panelini kapat', templates: 'Şablonlar', templateName: 'Şablon adı…',
    saveSettings: 'Geçerli ayarları kaydet', updateSettings: 'Geçerli ayarlarla güncelle', delete: 'Sil',
    imageGeneration: 'Görsel üretimi', action: 'İşlem', preparing: 'Hazırlanıyor…',
    welcome: 'Hoş geldin, {name}', savingLanguage: 'Dil kaydediliyor…', languageSaveError: 'Dil bu oturumda değişti, ancak kaydedilemedi. Yeniden dene', retryLanguage: 'Dili yeniden kaydet',
  },
} as const;
export type Language = keyof typeof messages;
export type MessageKey = keyof typeof messages.en;
export const LANGUAGE_STORAGE_KEY = 'banana.ui.language.v1';
export const validLanguage = (value: unknown): value is Language => value === 'tr' || value === 'en';
export function initialLanguage(storage: Pick<Storage, 'getItem'> | undefined, browserLanguage: string, serverLanguage?: unknown): Language {
  if (validLanguage(serverLanguage)) return serverLanguage;
  try { const saved = storage?.getItem(LANGUAGE_STORAGE_KEY); if (validLanguage(saved)) return saved; } catch { /* Private mode can deny storage. */ }
  return /^tr(?:-|$)/i.test(browserLanguage) ? 'tr' : 'en';
}
export function translate(language: Language, key: MessageKey, values: Record<string, string | number> = {}): string {
  const text: string = messages[language]?.[key] ?? messages.en[key] ?? key;
  return text.replace(/\{([a-zA-Z_][\w]*)\}/g, (placeholder, name: string) => Object.hasOwn(values, name) ? String(values[name]) : placeholder);
}
