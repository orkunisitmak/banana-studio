export interface ShortcutKeyboardEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
}

export function isGenerationShortcut(event: ShortcutKeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey)
    && event.key === 'Enter'
    && !event.repeat
    && !event.isComposing;
}
