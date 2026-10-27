/** WebKit and WebView2 can expose clipboard files through either collection.
 * Leave plain text to the native editor, including Unicode and @ mentions. */
export function getClipboardImages(data: Pick<DataTransfer, 'items' | 'files'> | null): File[] {
  if (!data) return [];
  const items = Array.from(data.items || [])
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile()).filter((file): file is File => file != null);
  if (items.length) return items;
  return Array.from(data.files || []).filter(file => file.type.startsWith('image/') || /\.(?:heic|heif)$/i.test(file.name));
}
