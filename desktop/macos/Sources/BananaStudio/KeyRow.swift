import AppKit

/// One provider row in the Provider API Keys window: lamp, masked saved key, entry field, Test and Remove.
final class KeyRow: NSObject {
    static let amber = NSColor(srgbRed: 0.98, green: 0.75, blue: 0.14, alpha: 1)
    let key: ProviderKey
    let view = NSStackView()
    let field = NSSecureTextField()
    let remove = NSButton(checkboxWithTitle: "Remove", target: nil, action: nil)
    private let lamp = NSImageView()
    private let status = NSTextField(labelWithString: "")
    private let test = NSButton(title: "Test", target: nil, action: nil)
    private let saved: String?
    private var checking = false

    init(_ key: ProviderKey) {
        self.key = key; saved = (try? KeyVault.read(key)) ?? nil
        super.init()
        view.orientation = .horizontal; view.spacing = 10
        lamp.symbolConfiguration = .init(pointSize: 14, weight: .medium); lamp.wantsLayer = true
        lamp.widthAnchor.constraint(equalToConstant: 18).isActive = true
        let label = NSTextField(labelWithString: key.label); label.widthAnchor.constraint(equalToConstant: 124).isActive = true
        field.widthAnchor.constraint(equalToConstant: 260).isActive = true
        if let saved {
            // Shown as the placeholder: typing a new key replaces it, and the masked text itself is never saved.
            field.placeholderAttributedString = NSAttributedString(string: KeyVault.masked(saved), attributes: [
                .foregroundColor: NSColor.labelColor, .font: NSFont.monospacedSystemFont(ofSize: NSFont.systemFontSize, weight: .regular)])
        } else { field.placeholderString = "Paste your API key" }
        test.bezelStyle = .rounded; test.controlSize = .small; test.target = self; test.action = #selector(runTest)
        status.font = .systemFont(ofSize: NSFont.smallSystemFontSize); status.lineBreakMode = .byTruncatingTail
        status.widthAnchor.constraint(equalToConstant: 92).isActive = true
        [lamp, label, field, test, status, remove].forEach(view.addArrangedSubview)
        setLamp(saved != nil ? .lit : .off)
    }

    private enum Lamp { case lit, off, broken }
    /// A lit amber bulb (the Brainstorm lamp) marks a saved or working key; a slashed red bulb marks a rejected one.
    private func setLamp(_ state: Lamp) {
        let name = state == .lit ? "lightbulb.fill" : state == .broken ? "lightbulb.slash" : "lightbulb"
        let description = state == .lit ? "\(key.label) key saved" : state == .broken ? "\(key.label) key rejected" : "No \(key.label) key"
        lamp.image = NSImage(systemSymbolName: name, accessibilityDescription: description)
        lamp.contentTintColor = state == .lit ? Self.amber : state == .broken ? .systemRed : .tertiaryLabelColor
        if state == .lit {
            let glow = NSShadow(); glow.shadowColor = Self.amber.withAlphaComponent(0.85); glow.shadowBlurRadius = 6; glow.shadowOffset = .zero
            lamp.shadow = glow
        } else { lamp.shadow = nil }
    }

    private func show(_ text: String, _ color: NSColor) { status.stringValue = text; status.textColor = color; status.toolTip = text }

    /// Tests the typed key when there is one, otherwise the saved key.
    @objc private func runTest() {
        guard !checking else { return }
        let typed = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let value = typed.isEmpty ? saved : typed else { show("Enter a key first", .secondaryLabelColor); return }
        checking = true; test.isEnabled = false; show("Checking…", .secondaryLabelColor)
        KeyCheck.run(key, value: value) { [weak self] outcome in
            guard let self else { return }
            self.checking = false; self.test.isEnabled = true
            switch outcome {
            case .working: self.show("✓ Working", .systemGreen); self.setLamp(.lit)
            case .rejected: self.show("✕ Key rejected", .systemRed); self.setLamp(.broken)
            case .unverified(let code): self.show("Not verified (\(code))", .systemOrange)
            case .unreachable: self.show("No connection", .systemOrange)
            }
        }
    }
}
