import XCTest
@testable import BananaStudio

final class KeyVaultTests: XCTestCase {
    func testKeychainRoundTripUsesAnIsolatedDisposableService() throws {
        let service = "com.bananastudio.tests.\(UUID().uuidString)"
        defer { try? KeyVault.save(.openAI, value: nil, service: service) }
        XCTAssertNil(try KeyVault.read(.openAI, service: service))
        try KeyVault.save(.openAI, value: "synthetic-test-value", service: service)
        XCTAssertEqual(try KeyVault.read(.openAI, service: service), "synthetic-test-value")
        try KeyVault.save(.openAI, value: "replacement-test-value", service: service)
        XCTAssertEqual(try KeyVault.read(.openAI, service: service), "replacement-test-value")
        try KeyVault.save(.openAI, value: nil, service: service)
        XCTAssertNil(try KeyVault.read(.openAI, service: service))
    }
    func testInvalidValuesAreRejectedBeforeWriting() throws {
        let service = "com.bananastudio.tests.\(UUID().uuidString)"
        defer { try? KeyVault.save(.openAI, value: nil, service: service) }
        XCTAssertThrowsError(try KeyVault.save(.openAI, value: "line\nbreak", service: service))
        XCTAssertThrowsError(try KeyVault.save(.openAI, value: String(repeating: "a", count: 4096), service: service))
        XCTAssertNil(try KeyVault.read(.openAI, service: service))
    }
    func testLocalDefaultsDoNotEnableAnExistingInstallation() throws {
        let service = "com.bananastudio.tests.\(UUID().uuidString)"
        defer { try? KeyVault.save(.openAI, value: nil, service: service) }
        XCTAssertTrue(try KeyVault.all(service: service).isEmpty)
        try KeyVault.save(.openAI, value: "synthetic-existing-provider", service: service)
        XCTAssertEqual(try KeyVault.all(service: service), ["OPENAI_API_KEY": "synthetic-existing-provider"])
    }
    func testLocalKeyActivatesDefaultsAndCanBeRemoved() throws {
        let service = "com.bananastudio.tests.\(UUID().uuidString)"
        defer { try? KeyVault.save(.localAPI, value: nil, service: service) }
        try KeyVault.save(.localAPI, value: "synthetic-local-key", service: service)
        let values = try KeyVault.all(service: service)
        XCTAssertEqual(values["LOCAL_API_KEY"], "synthetic-local-key")
        for setting in LocalProviderSetting.allCases { XCTAssertEqual(values[setting.rawValue], setting.defaultValue) }
        try KeyVault.save(.localAPI, value: nil, service: service)
        XCTAssertTrue(try KeyVault.all(service: service).isEmpty)
    }
    func testEachLocalSettingActivatesDefaultsWithoutAnAPIKey() throws {
        let service = "com.bananastudio.tests.\(UUID().uuidString)"
        defer { for setting in LocalProviderSetting.allCases { try? KeyVault.save(setting, value: nil, service: service) } }
        for setting in LocalProviderSetting.allCases {
            try KeyVault.save(setting, value: setting.defaultValue, service: service)
            let values = try KeyVault.all(service: service)
            XCTAssertNil(values["LOCAL_API_KEY"])
            for item in LocalProviderSetting.allCases { XCTAssertEqual(values[item.rawValue], item.defaultValue) }
            try KeyVault.save(setting, value: nil, service: service)
            XCTAssertTrue(try KeyVault.all(service: service).isEmpty)
        }
    }
    func testLocalConfigurationRoundTripAndRefreshPayload() throws {
        let service = "com.bananastudio.tests.\(UUID().uuidString)"
        defer {
            try? KeyVault.save(.localAPI, value: nil, service: service)
            for setting in LocalProviderSetting.allCases { try? KeyVault.save(setting, value: nil, service: service) }
        }
        try KeyVault.save(.baseURL, value: " https://example.invalid/custom/v1 ", service: service)
        try KeyVault.save(.textModel, value: " custom/text-model ", service: service)
        try KeyVault.save(.imageModel, value: "custom/image-model", service: service)
        XCTAssertEqual(try KeyVault.all(service: service), [
            "LOCAL_API_BASE_URL": "https://example.invalid/custom/v1", "LOCAL_TEXT_MODEL": "custom/text-model", "LOCAL_IMAGE_MODEL": "custom/image-model"
        ])
        try KeyVault.save(.localAPI, value: "synthetic-local-key", service: service)
        try KeyVault.save(.localAPI, value: nil, service: service)
        XCTAssertNil(try KeyVault.all(service: service)["LOCAL_API_KEY"])
        XCTAssertEqual(try KeyVault.all(service: service)["LOCAL_API_BASE_URL"], "https://example.invalid/custom/v1")
        for setting in LocalProviderSetting.allCases { try KeyVault.save(setting, value: " ", service: service) }
        XCTAssertTrue(try KeyVault.all(service: service).isEmpty)
    }
    func testLocalBaseURLValidationRejectsCredentialsQueryAndFragment() throws {
        for value in ["http://localhost:20128/v1", "https://example.invalid/custom/v1/", "http://127.0.0.1:8080/v1", "http://[::1]:20128/v1"] {
            XCTAssertEqual(try LocalProviderSetting.baseURL.validatedValue(" \(value) "), value)
        }
        for value in ["localhost:20128/v1", "/v1", "ftp://localhost/v1", "http:///v1", "http://user:password@localhost/v1", "http://@localhost/v1",
                      "http://localhost/v1?", "http://localhost/v1?token=synthetic", "http://localhost/v1#", "http://localhost/v1#fragment", "http://local host/v1",
                      "http://localhost:65536/v1", "http://localhost:0/v1", "http://localhost\\v1", "http://localhost/v1\npath"] {
            XCTAssertThrowsError(try LocalProviderSetting.baseURL.validatedValue(value)) { error in
                XCTAssertEqual(error as? KeyVault.VaultError, .invalidLocalBaseURL)
            }
        }
        XCTAssertNil(try LocalProviderSetting.baseURL.validatedValue(" "))
    }
    func testLocalModelValidationAllowsCustomIDsWithinBackendLimits() throws {
        let models = ["cx/gpt-6.1-sol", "cx/gpt-image-2.5", "cx/gpt-image-2.5-flare", "cx/gpt-image-2.5-sunburst", "cx/gpt-image-2", "cx/gpt-image-1.5",
                      "cx/gpt-5.6-sol-image", "cx/gpt-5.6-terra-image", "cx/gpt-5.6-luna-image", "any/custom-model", String(repeating: "a", count: 200)]
        for setting in [LocalProviderSetting.textModel, .imageModel] {
            for model in models { XCTAssertEqual(try setting.validatedValue(" \(model) "), model) }
            for value in ["model id", "model\tid", "model\nid", "model\rid", "model\0id", "model\u{7f}id", "model\u{85}id", String(repeating: "a", count: 201), String(repeating: "😀", count: 101)] {
                XCTAssertThrowsError(try setting.validatedValue(value)) { error in
                    XCTAssertEqual(error as? KeyVault.VaultError, .invalidLocalModel)
                }
            }
            XCTAssertNil(try setting.validatedValue(" "))
        }
    }
    func testInvalidLocalConfigurationDoesNotReplaceSavedValues() throws {
        let service = "com.bananastudio.tests.\(UUID().uuidString)"
        defer { for setting in LocalProviderSetting.allCases { try? KeyVault.save(setting, value: nil, service: service) } }
        try KeyVault.save(.baseURL, value: LocalProviderSetting.baseURL.defaultValue, service: service)
        try KeyVault.save(.imageModel, value: "custom/model", service: service)
        XCTAssertThrowsError(try KeyVault.save(.baseURL, value: "http://user:password@localhost/v1", service: service))
        XCTAssertThrowsError(try KeyVault.save(.imageModel, value: "invalid model", service: service))
        XCTAssertEqual(try KeyVault.read(.baseURL, service: service), LocalProviderSetting.baseURL.defaultValue)
        XCTAssertEqual(try KeyVault.read(.imageModel, service: service), "custom/model")
    }
}
