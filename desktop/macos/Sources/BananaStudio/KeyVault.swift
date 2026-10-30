import Foundation
import Security

enum ProviderKey: String, CaseIterable {
    case openAI = "OPENAI_API_KEY", openRouter = "OPENROUTER_API_KEY", gemini = "GEMINI_API_KEY"
    case fal = "FAL_KEY", evolink = "EVOLINK_API_KEY", youtube = "YOUTUBE_API_KEY"
    case localAPI = "LOCAL_API_KEY"
    var label: String {
        switch self { case .openAI: return "OpenAI"; case .openRouter: return "OpenRouter"; case .gemini: return "Google Gemini"; case .fal: return "fal.ai"; case .evolink: return "EvoLink"; case .youtube: return "YouTube Data API"; case .localAPI: return "Local API key" }
    }
}

enum LocalProviderSetting: String, CaseIterable {
    case baseURL = "LOCAL_API_BASE_URL", textModel = "LOCAL_TEXT_MODEL", imageModel = "LOCAL_IMAGE_MODEL"
    var label: String {
        switch self { case .baseURL: return "Local base URL"; case .textModel: return "Local text model ID"; case .imageModel: return "Local image model ID" }
    }
    var defaultValue: String {
        switch self { case .baseURL: return "http://localhost:20128/v1"; case .textModel: return "cx/gpt-6.1-sol"; case .imageModel: return "cx/gpt-image-2.5" }
    }
    func validatedValue(_ value: String?) throws -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        if self == .baseURL {
            guard value.rangeOfCharacter(from: .whitespacesAndNewlines.union(.controlCharacters)) == nil,
                  !value.contains("\\"), let url = URLComponents(string: value),
                  ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
                  let host = url.host, !host.isEmpty, url.url != nil,
                  url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
                  url.port.map({ (1...65535).contains($0) }) ?? true else { throw KeyVault.VaultError.invalidLocalBaseURL }
        } else {
            guard value.utf16.count <= 200, value.rangeOfCharacter(from: .whitespacesAndNewlines.union(.controlCharacters)) == nil else { throw KeyVault.VaultError.invalidLocalModel }
        }
        try KeyVault.validate(value: value)
        return value
    }
}

enum KeyVault {
    static let service = "com.bananastudio.provider-keys"
    private static func query(_ name: String, service: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: name]
    }
    static func read(_ key: ProviderKey, service: String = KeyVault.service) throws -> String? {
        try read(key.rawValue, service: service)
    }
    static func read(_ setting: LocalProviderSetting, service: String = KeyVault.service) throws -> String? {
        try read(setting.rawValue, service: service)
    }
    private static func read(_ name: String, service: String) throws -> String? {
        var q = query(name, service: service); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let bytes = result as? Data, let value = String(data: bytes, encoding: .utf8) else { throw VaultError.unavailable }
        return value
    }
    static func save(_ key: ProviderKey, value: String?, service: String = KeyVault.service) throws {
        try save(key.rawValue, value: value, service: service)
    }
    // Nonsecret settings share the vault so startup and refresh use the same private pipe.
    static func save(_ setting: LocalProviderSetting, value: String?, service: String = KeyVault.service) throws {
        try save(setting.rawValue, value: setting.validatedValue(value), service: service)
    }
    static func validate(value: String?) throws {
        guard let value else { return }
        guard value.utf8.count < 4096, !value.contains("\n"), !value.contains("\r") else { throw VaultError.invalid }
    }
    private static func save(_ name: String, value: String?, service: String) throws {
        try validate(value: value)
        let q = query(name, service: service)
        guard let value, !value.isEmpty else {
            let result = SecItemDelete(q as CFDictionary)
            guard result == errSecSuccess || result == errSecItemNotFound else { throw VaultError.unavailable }; return
        }
        let bytes = Data(value.utf8)
        let result = SecItemUpdate(q as CFDictionary, [kSecValueData as String: bytes] as CFDictionary)
        if result == errSecItemNotFound {
            var insert = q; insert[kSecValueData as String] = bytes
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else { throw VaultError.unavailable }
        } else if result != errSecSuccess { throw VaultError.unavailable }
    }
    static func all(service: String = KeyVault.service) throws -> [String: String] {
        var values: [String: String] = [:]
        for key in ProviderKey.allCases { if let value = try read(key, service: service) { values[key.rawValue] = value } }
        let settings = try LocalProviderSetting.allCases.map { ($0, try read($0, service: service)) }
        // Existing installations must not enable localhost routing until a local value is saved.
        if values[ProviderKey.localAPI.rawValue] != nil || settings.contains(where: { $0.1 != nil }) {
            for (setting, value) in settings { values[setting.rawValue] = try setting.validatedValue(value) ?? setting.defaultValue }
        }
        return values
    }
    enum VaultError: Error { case unavailable, invalid, invalidLocalBaseURL, invalidLocalModel }
}
