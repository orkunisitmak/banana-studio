import Foundation
import Security

enum ProviderKey: String, CaseIterable {
    case openAI = "OPENAI_API_KEY", openRouter = "OPENROUTER_API_KEY", gemini = "GEMINI_API_KEY"
    case fal = "FAL_KEY", evolink = "EVOLINK_API_KEY", youtube = "YOUTUBE_API_KEY"
    var label: String {
        switch self { case .openAI: return "OpenAI"; case .openRouter: return "OpenRouter"; case .gemini: return "Google Gemini"; case .fal: return "fal.ai"; case .evolink: return "EvoLink"; case .youtube: return "YouTube Data API" }
    }
}

enum KeyVault {
    static let service = "com.bananastudio.provider-keys"
    static func query(_ key: ProviderKey, service: String = KeyVault.service) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key.rawValue]
    }
    static func read(_ key: ProviderKey, service: String = KeyVault.service) throws -> String? {
        var q = query(key, service: service); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let bytes = result as? Data, let value = String(data: bytes, encoding: .utf8) else { throw VaultError.unavailable }
        return value
    }
    static func save(_ key: ProviderKey, value: String?, service: String = KeyVault.service) throws {
        let q = query(key, service: service)
        guard let value, !value.isEmpty else {
            let result = SecItemDelete(q as CFDictionary)
            guard result == errSecSuccess || result == errSecItemNotFound else { throw VaultError.unavailable }; return
        }
        guard value.utf8.count < 4096, !value.contains("\n"), !value.contains("\r") else { throw VaultError.invalid }
        let bytes = Data(value.utf8)
        let result = SecItemUpdate(q as CFDictionary, [kSecValueData as String: bytes] as CFDictionary)
        if result == errSecItemNotFound {
            var insert = q; insert[kSecValueData as String] = bytes
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else { throw VaultError.unavailable }
        } else if result != errSecSuccess { throw VaultError.unavailable }
    }
    static func all() throws -> [String: String] {
        var values: [String: String] = [:]
        for key in ProviderKey.allCases { if let value = try read(key) { values[key.rawValue] = value } }
        return values
    }
    /// First and last four characters around a fixed run of dots, so the preview never reveals the key length.
    /// Keys shorter than 16 characters are fully masked so most of the secret stays hidden.
    static func masked(_ value: String) -> String {
        let dots = String(repeating: "•", count: 8)
        guard value.count >= 16 else { return dots }
        return "\(value.prefix(4))\(dots)\(value.suffix(4))"
    }
    enum VaultError: Error { case unavailable, invalid }
}
