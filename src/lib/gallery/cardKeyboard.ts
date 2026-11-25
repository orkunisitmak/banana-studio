// Enter and Space on the card itself activate it; keys pressed inside its action buttons do not.
// A held key repeats keydown, and each repeat would toggle the selection again, so repeats are ignored.
export const isCardActivationKey = (key: string, onCardItself: boolean, repeat = false) => onCardItself && !repeat && (key === 'Enter' || key === ' ');

// The position tells cards with the same prompt apart, for example several variants of one idea.
export const galleryCardLabel = (mediaType: string | undefined, prompt: string | undefined, isSelectionMode: boolean, isSelected: boolean, position: number, total: number) => {
  const kind = mediaType === 'video' ? 'video' : 'image';
  const action = isSelectionMode ? (isSelected ? `Deselect ${kind}` : `Select ${kind}`) : `Open ${kind}`;
  return `${action} ${position} of ${total}: ${(prompt || '').slice(0, 80)}`;
};
