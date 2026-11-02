type EnterKeyEvent = { key: string; nativeEvent: { isComposing: boolean } };

// Enter that confirms an IME candidate must not submit the field.
export const submitOnEnter = (submit: () => void) => (event: EnterKeyEvent) => {
  if (event.key === 'Enter' && !event.nativeEvent.isComposing) submit();
};
