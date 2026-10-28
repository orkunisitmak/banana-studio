import Foundation

/// Verifies a provider key with one free, read-only request. The key goes only to its own provider.
enum KeyCheck {
    enum Outcome: Equatable { case working, rejected, unverified(Int), unreachable }

    static func request(_ key: ProviderKey, value: String) -> URLRequest {
        func make(_ url: String, _ header: String, _ credential: String) -> URLRequest {
            var request = URLRequest(url: URL(string: url)!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
            request.setValue(credential, forHTTPHeaderField: header); return request
        }
        switch key {
        case .openAI: return make("https://api.openai.com/v1/models", "Authorization", "Bearer \(value)")
        case .openRouter: return make("https://openrouter.ai/api/v1/key", "Authorization", "Bearer \(value)")
        case .gemini: return make("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", "x-goog-api-key", value)
        // fal has no key-info route: a status lookup for a request that cannot exist answers 401/403 only for a bad key.
        case .fal: return make("https://queue.fal.run/fal-ai/nano-banana-pro/requests/__probe__/status", "Authorization", "Key \(value)")
        case .evolink: return make("https://api.evolink.ai/v1/credits", "Authorization", "Bearer \(value)")
        case .youtube: return make("https://www.googleapis.com/youtube/v3/i18nLanguages?part=snippet&hl=en", "x-goog-api-key", value)
        }
    }

    static func outcome(_ key: ProviderKey, status: Int) -> Outcome {
        if status == 401 || status == 403 { return .rejected }
        // Google reports an unknown key as 400 API_KEY_INVALID.
        if status == 400, key == .gemini || key == .youtube { return .rejected }
        if (200..<300).contains(status) || (key == .fal && (400..<500).contains(status)) { return .working }
        return .unverified(status)
    }

    static func run(_ key: ProviderKey, value: String, completion: @escaping (Outcome) -> Void) {
        let request = request(key, value: value)
        URLSession(configuration: .ephemeral).dataTask(with: request) { _, response, _ in
            let result = (response as? HTTPURLResponse).map { outcome(key, status: $0.statusCode) } ?? .unreachable
            DispatchQueue.main.async { completion(result) }
        }.resume()
    }
}
