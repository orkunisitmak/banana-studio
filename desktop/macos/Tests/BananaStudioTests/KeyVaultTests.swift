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
    func testMaskedPreviewShowsOnlyTheEdgesAndHidesTheLength() {
        XCTAssertEqual(KeyVault.masked("sk-synthetic-test-value-wxyz"), "sk-s••••••••wxyz")
        XCTAssertEqual(KeyVault.masked("abcd1234efgh5678ijkl"), "abcd••••••••ijkl")
        XCTAssertEqual(KeyVault.masked("short-value"), "••••••••")
        XCTAssertEqual(KeyVault.masked(""), "••••••••")
    }
    func testKeyCheckSendsEachKeyOnlyToItsOwnProvider() {
        let hosts: [ProviderKey: String] = [.openAI: "api.openai.com", .openRouter: "openrouter.ai", .gemini: "generativelanguage.googleapis.com",
                                            .fal: "queue.fal.run", .evolink: "api.evolink.ai", .youtube: "www.googleapis.com"]
        for key in ProviderKey.allCases {
            let request = KeyCheck.request(key, value: "synthetic-test-value")
            XCTAssertEqual(request.url?.scheme, "https"); XCTAssertEqual(request.url?.host, hosts[key])
            XCTAssertEqual(request.httpMethod ?? "GET", "GET")
            XCTAssertFalse(request.url!.absoluteString.contains("synthetic-test-value"), "keys travel in headers, not URLs")
        }
    }
    func testKeyCheckOutcomes() {
        XCTAssertEqual(KeyCheck.outcome(.openAI, status: 200), .working)
        XCTAssertEqual(KeyCheck.outcome(.openAI, status: 401), .rejected)
        XCTAssertEqual(KeyCheck.outcome(.gemini, status: 400), .rejected)
        XCTAssertEqual(KeyCheck.outcome(.openRouter, status: 400), .unverified(400))
        XCTAssertEqual(KeyCheck.outcome(.fal, status: 404), .working)
        XCTAssertEqual(KeyCheck.outcome(.fal, status: 403), .rejected)
        XCTAssertEqual(KeyCheck.outcome(.fal, status: 500), .unverified(500))
        XCTAssertEqual(KeyCheck.outcome(.evolink, status: 429), .unverified(429))
    }
    func testInvalidValuesAreRejectedBeforeWriting() throws {
        let service = "com.bananastudio.tests.\(UUID().uuidString)"
        defer { try? KeyVault.save(.openAI, value: nil, service: service) }
        XCTAssertThrowsError(try KeyVault.save(.openAI, value: "line\nbreak", service: service))
        XCTAssertThrowsError(try KeyVault.save(.openAI, value: String(repeating: "a", count: 4096), service: service))
        XCTAssertNil(try KeyVault.read(.openAI, service: service))
    }
}
