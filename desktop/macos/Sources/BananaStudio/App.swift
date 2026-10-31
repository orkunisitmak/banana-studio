import AppKit
import WebKit
import Sparkle

@main
final class BananaStudioApp: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {
    private let workspace = WorkspaceProcess()
    private var window: NSWindow!
    private var webView: WKWebView!
    private var updater: SPUStandardUpdaterController?
    private var origin: URL?
    private var launchMessage: NSTextField!
    private let placement = WindowPlacementStore(url: WorkspaceProcess.dataDirectory.appendingPathComponent("window-placement.json"))
    private var normalWindowFrame: NSRect?
    private var fullscreenTransition = false

    static func main() {
        if CommandLine.arguments.contains("--raster-codec") { exit(RasterCodec.run()) }
        let app = NSApplication.shared, delegate = BananaStudioApp()
        app.setActivationPolicy(.regular); app.delegate = delegate; app.run()
        withExtendedLifetime(delegate) {}
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.appearance = NSAppearance(named: .darkAqua)
        let config = WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent()
        config.userContentController.add(self, name: "bananaNative")
        webView = WKWebView(frame: .zero, configuration: config); webView.navigationDelegate = self; webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1400, height: 900), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Banana Studio"; window.contentView = webView; window.center()
        fitWindow(placement.load() ?? window.frame)
        normalWindowFrame = window.frame; window.delegate = self
        launchMessage = NSTextField(labelWithString: "Opening your local workspace…")
        launchMessage.textColor = .secondaryLabelColor; launchMessage.translatesAutoresizingMaskIntoConstraints = false; webView.addSubview(launchMessage)
        NSLayoutConstraint.activate([launchMessage.centerXAnchor.constraint(equalTo: webView.centerXAnchor), launchMessage.centerYAnchor.constraint(equalTo: webView.centerYAnchor)])
        makeMenu(); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        workspace.ready = { [weak self] url, token in
            guard let self else { return }; self.origin = url
            var request = URLRequest(url: url.appendingPathComponent("local/bootstrap")); request.setValue(token, forHTTPHeaderField: "X-Banana-Bootstrap")
            self.webView.load(request); self.launchMessage.isHidden = true
        }
        workspace.failed = { [weak self] in self?.showFailure() }
        do { try workspace.start() } catch { workspace.stop(); showFailure() }
        if Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String != nil, Bundle.main.object(forInfoDictionaryKey: "BananaDevelopmentBuild") as? Bool != true {
            updater = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
        }
    }
    func makeMenu() {
        let menu = NSMenu(), app = NSMenu(), file = NSMenu(), edit = NSMenu(), windowMenu = NSMenu()
        let appItem = menu.addItem(withTitle: "Banana Studio", action: nil, keyEquivalent: ""); appItem.submenu = app
        app.addItem(withTitle: "About Banana Studio", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        app.addItem(withTitle: "Provider API Keys…", action: #selector(showKeys), keyEquivalent: ",").target = self
        app.addItem(withTitle: "Check for Updates…", action: #selector(checkUpdates), keyEquivalent: "").target = self
        app.addItem(.separator()); app.addItem(withTitle: "Quit Banana Studio", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(withTitle: "File", action: nil, keyEquivalent: "").submenu = file
        file.addItem(withTitle: "Open Local Data Folder", action: #selector(openData), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Edit", action: nil, keyEquivalent: "").submenu = edit
        for (title, action, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] { edit.addItem(withTitle: title, action: Selector(action), keyEquivalent: key) }
        let redo = NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "z"); redo.keyEquivalentModifierMask = [.command, .shift]; edit.insertItem(redo, at: 1)
        menu.addItem(withTitle: "Window", action: nil, keyEquivalent: "").submenu = windowMenu
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f").keyEquivalentModifierMask = [.control, .command]
        NSApp.mainMenu = menu; NSApp.windowsMenu = windowMenu
    }
    @objc func openData() { NSWorkspace.shared.open(WorkspaceProcess.dataDirectory) }
    @objc func checkUpdates() {
        guard let updater else { let alert = NSAlert(); alert.messageText = "Updates are not configured in this development build."; alert.runModal(); return }
        updater.checkForUpdates(self)
    }
    @objc func showKeys() {
        let alert = NSAlert(); alert.messageText = "Provider API Keys"; alert.informativeText = "Add only the providers you use. OpenRouter can cover text, images and supported Seedance video; fal.ai covers images and video. Claude plan token (from `claude setup-token`) runs Opus 5.5 on your Claude subscription. Choose Auto or a provider in AI settings. Keys stay in macOS Keychain. Blank fields keep existing keys. Remove clears a saved key."
        alert.addButton(withTitle: "Save"); alert.addButton(withTitle: "Cancel")
        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 12
        var rows: [(ProviderKey, NSSecureTextField, NSButton)] = []
        for key in ProviderKey.allCases {
            let row = NSStackView(); row.orientation = .horizontal; row.spacing = 10
            let label = NSTextField(labelWithString: key.label); label.widthAnchor.constraint(equalToConstant: 124).isActive = true
            let field = NSSecureTextField(); field.widthAnchor.constraint(equalToConstant: 290).isActive = true
            field.placeholderString = ((try? KeyVault.read(key)) ?? nil) != nil ? "Saved in Keychain" : key == .claude ? "Paste the claude setup-token output" : "Paste your API key"
            let remove = NSButton(checkboxWithTitle: "Remove", target: nil, action: nil)
            row.addArrangedSubview(label); row.addArrangedSubview(field); row.addArrangedSubview(remove); stack.addArrangedSubview(row); rows.append((key, field, remove))
        }
        stack.frame = NSRect(x: 0, y: 0, width: 560, height: 262)
        stack.widthAnchor.constraint(equalToConstant: 560).isActive = true
        alert.accessoryView = stack
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        do {
            for (key, field, remove) in rows {
                if remove.state == .on { try KeyVault.save(key, value: nil) }
                else if !field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { try KeyVault.save(key, value: field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)) }
                field.stringValue = ""
            }
            try workspace.refreshKeys()
        } catch { let failure = NSAlert(); failure.messageText = "The keys could not be saved or activated."; failure.informativeText = "Unlock your login Keychain and try again. No key value is included in this message."; failure.runModal() }
    }
    func showFailure() { launchMessage.isHidden = false; launchMessage.stringValue = "The local workspace could not start. Reopen Banana Studio. Your data is kept on this Mac." }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) { saveWindowPlacement(); workspace.stop() }
    private func fitWindow(_ frame: NSRect) {
        let fitted = WindowPlacement.constrain(frame, to: NSScreen.screens.map(\.visibleFrame))
        window.minSize = NSSize(width: min(760, fitted.width), height: min(560, fitted.height))
        window.setFrame(fitted, display: false)
    }
    private func captureNormalWindowFrame() {
        guard !fullscreenTransition, !window.isMiniaturized, !window.isZoomed, !window.styleMask.contains(.fullScreen) else { return }
        normalWindowFrame = window.frame
    }
    private func saveWindowPlacement() {
        captureNormalWindowFrame()
        if let normalWindowFrame { placement.save(normalWindowFrame) }
    }
    func windowDidMove(_ notification: Notification) { captureNormalWindowFrame() }
    func windowDidResize(_ notification: Notification) { captureNormalWindowFrame() }
    func windowWillClose(_ notification: Notification) { saveWindowPlacement() }
    func windowWillEnterFullScreen(_ notification: Notification) { captureNormalWindowFrame(); fullscreenTransition = true }
    func windowDidFailToEnterFullScreen(_ window: NSWindow) { fullscreenTransition = false; captureNormalWindowFrame() }
    func windowDidExitFullScreen(_ notification: Notification) { fullscreenTransition = false; captureNormalWindowFrame() }
    func applicationDidChangeScreenParameters(_ notification: Notification) {
        guard window != nil, !window.isMiniaturized, !window.isZoomed, !fullscreenTransition, !window.styleMask.contains(.fullScreen) else { return }
        fitWindow(normalWindowFrame ?? window.frame); captureNormalWindowFrame()
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let origin,
              message.frameInfo.securityOrigin.host == origin.host,
              message.frameInfo.securityOrigin.port == origin.port,
              message.frameInfo.securityOrigin.protocol == origin.scheme,
              let body = message.body as? [String: String] else { return }
        if body["action"] == "keys" { showKeys() }
        if body["action"] == "lock" { NSApp.terminate(self) }
    }
    private func allowed(_ url: URL?) -> Bool { guard let url, let origin else { return false }; return url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload && (allowed(navigationAction.request.url) || navigationAction.request.url?.scheme == "blob") { decisionHandler(.download); return }
        if allowed(navigationAction.request.url) || navigationAction.request.url?.absoluteString == "about:blank" { decisionHandler(.allow); return }
        if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url, url.scheme == "https" { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "https" { NSWorkspace.shared.open(url) }; return nil
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard frame.isMainFrame, allowed(frame.request.url) else { completionHandler(nil); return }
        let panel = NSOpenPanel(); panel.canChooseDirectories = parameters.allowsDirectories; panel.canChooseFiles = true; panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.urls : nil) }
    }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel(); panel.nameFieldStringValue = URL(fileURLWithPath: suggestedFilename).lastPathComponent
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.url : nil) }
    }
}
