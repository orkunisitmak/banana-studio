# Mac and Windows desktop behavior

[Install](desktop.md) · [Türkçe](../tr/desktop-parity.md)

Both shells load the same production React build and local Node/SQLite server. Library, templates, generation, Enhance, Brainstorm, area masks, progress, comparison and preview do not have a separate Windows implementation.

| Workflow | Mac | Windows |
| --- | --- | --- |
| Generate | Command + Enter | Ctrl + Enter |
| Enhance | Command + Shift + E | Ctrl + Shift + E |
| Simple Brainstorm | Command + Shift + S | Ctrl + Shift + S |
| YouTube Brainstorm | Command + Shift + Y | Ctrl + Shift + Y |
| Search gallery | Command + K | Ctrl + K |
| Copy / paste / select all | Command + C / V / A | Ctrl + C / V / A |
| Undo text | Command + Z | Ctrl + Z |
| Redo text | Command + Shift + Z | Ctrl + Y / Ctrl + Shift + Z (native editor) |
| Restore removed reference outside text fields | Command + Z | Ctrl + Z |
| Viewer navigation / dismiss | Left / Right / Escape | Left / Right / Escape |
| Viewer details | Shift + B | Shift + B |
| New selection layer | Shift + draw | Shift + draw |
| Provider keys | Command + comma | Ctrl + comma or File menu |
| Window fullscreen | Control + Command + F | F11 (F11 or Esc to exit) |
| Image zoom / fit | + / − / 0 | + / − / 0 |

Text paste stays in the focused native editor, preserving Turkish characters, line breaks and `@` reference syntax. Image paste reads the browser's image items or file collection, then goes through the same reference upload path. Clipboard access is requested by an actual paste; no background clipboard reader is installed. Copying a file's path as text does not upload the file. Use the upload button if an application does not provide clipboard image data.

Library records and original media are saved locally, including grouped People and templates. Preview URLs are refreshed after restarting the random-port local server. Video previews support byte ranges. Image previews preserve the file's aspect ratio; original-image viewing, source/edit comparison and download use the shared gallery code.

Native differences remain intentional: macOS uses AppKit/WKWebView, Keychain and signed Sparkle updates. Windows uses WinForms/WebView2, Credential Manager and a manual GitHub download update. The Windows zip includes .NET, Node and the image codec; it needs the Microsoft WebView2 Runtime. Neither desktop app syncs to another computer or the hosted gallery automatically.

## Verification

Shared tests exercise clipboard fallback/duplicate handling, shell messages, Library persistence, thumbnail/source URL refresh, query and storage boundaries, video ranges and durable jobs. Mac and Windows CI run the packaged server through a synthetic image generation and area edit, checking every pixel outside the selection. The provider is mocked; these checks make no paid requests. Windows also tests an isolated Credential Manager entry and removal. Both Mac architectures are built in CI.

Compilation and these integration checks do not substitute for interactive clipboard, file-picker, keyboard, media playback and display-scaling tests on a physical Windows session. The release verification file records this limitation. Test these workflows with your own non-sensitive samples before adopting a new community build.

Both shells remember the normal window position and size. Saved bounds are clamped to a connected display after a monitor is removed. Fullscreen and maximized modes are not restored. macOS startup has the same 30-second readiness deadline as Windows; failure stops the child server and leaves saved files intact.
