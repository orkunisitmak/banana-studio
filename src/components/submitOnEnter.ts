type EnterKeyEvent = { key: string; keyCode: number; nativeEvent: { isComposing: boolean } };

// Enter that confirms an IME candidate must not submit the field. Safari can fire
// compositionend before this keydown, so isComposing is already false there; the
// keydown still reports keyCode 229.
export const submitOnEnter = (submit: () => void) => (event: EnterKeyEvent) => {
  if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) submit();
};
