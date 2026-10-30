import Foundation
import Security

final class WorkspaceProcess {
    private var process: Process?
    private var input: Pipe?
    private var output: Pipe?
    private var buffer = Data()
    private var started = false
    private var shuttingDown = false
    private var startup: WorkspaceStartup?
    private var activeKeys: [String: String] = [:]
    private(set) var unavailableKeys: [ProviderKey] = []
    private(set) var origin: URL?
    private(set) var bootstrap = ""
    var ready: ((URL, String) -> Void)?
    var failed: (() -> Void)?
    static var dataDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Banana Studio", isDirectory: true)
    }
    func start() throws {
        guard process == nil, let resources = Bundle.main.resourceURL else { return }
        let server = resources.appendingPathComponent("workspace/server.mjs")
        let executable = resources.appendingPathComponent("runtime/node")
        guard FileManager.default.isExecutableFile(atPath: executable.path), FileManager.default.fileExists(atPath: server.path) else { throw LaunchError.missingRuntime }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw LaunchError.entropy }
        bootstrap = bytes.map { String(format: "%02x", $0) }.joined()
        try FileManager.default.createDirectory(at: Self.dataDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let task = Process(), stdin = Pipe(), stdout = Pipe()
        task.executableURL = executable; task.arguments = [server.path]
        task.environment = ["PATH": "/usr/bin:/bin", "HOME": NSHomeDirectory(), "TMPDIR": NSTemporaryDirectory()]
        task.currentDirectoryURL = resources.appendingPathComponent("workspace")
        task.standardInput = stdin; task.standardOutput = stdout
        // Upstream diagnostics must not become persistent logs containing media,
        // prompts or keys. Readiness uses a small allowlisted stdout protocol.
        task.standardError = FileHandle.nullDevice
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            DispatchQueue.main.async { self?.receive(data) }
        }
        task.terminationHandler = { [weak self] _ in DispatchQueue.main.async { self?.failOnce() } }
        process = task; input = stdin; output = stdout
        try task.run()
        startup = WorkspaceStartup { [weak self] in self?.finishFailure() }
        try send(["dataDirectory": Self.dataDirectory.path, "webRoot": resources.appendingPathComponent("workspace/web").path, "bootstrap": bootstrap, "keys": loadKeys()])
    }
    private func receive(_ data: Data) {
        guard !data.isEmpty else { return }; buffer.append(data)
        guard buffer.count < 256_000 else { failOnce(); return }
        while let range = buffer.range(of: Data([10])) {
            let line = buffer.subdata(in: 0..<range.lowerBound); buffer.removeSubrange(0..<range.upperBound)
            guard !started, let value = try? JSONSerialization.jsonObject(with: line) as? [String: Any], value["event"] as? String == "ready", let raw = value["origin"] as? String, let url = URL(string: raw), url.scheme == "http", url.host == "127.0.0.1", url.port != nil else { continue }
            guard startup?.ready() == true else { continue }
            started = true; origin = url; ready?(url, bootstrap)
        }
    }
    private func send(_ value: [String: Any]) throws {
        var data = try JSONSerialization.data(withJSONObject: value); data.append(10)
        guard let handle = input?.fileHandleForWriting else { throw LaunchError.missingRuntime }
        try handle.write(contentsOf: data)
    }
    private func loadKeys() -> [String: String] {
        let snapshot = KeyVault.snapshot(previous: activeKeys)
        activeKeys = snapshot.values; unavailableKeys = snapshot.unavailable
        return activeKeys
    }
    func recordKeyChange(_ key: ProviderKey, value: String?) { activeKeys[key.rawValue] = value }
    func refreshKeys() throws { try send(["action": "keys", "keys": loadKeys()]) }
    private func failOnce() {
        guard !shuttingDown, startup?.fail() == true else { return }
        finishFailure()
    }
    private func finishFailure() {
        guard !shuttingDown else { return }
        output?.fileHandleForReading.readabilityHandler = nil
        buffer.removeAll()
        try? input?.fileHandleForWriting.close()
        if process?.isRunning == true { process?.terminate() }
        failed?()
    }
    func stop() {
        shuttingDown = true; startup?.stop(); startup = nil
        output?.fileHandleForReading.readabilityHandler = nil
        try? send(["action": "shutdown"]); try? input?.fileHandleForWriting.close()
        if process?.isRunning == true { process?.terminate() }
    }
    deinit { stop() }
    enum LaunchError: Error { case missingRuntime, entropy }
}
