using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace BananaStudio;

// The rollback itself failed. The previous install is intact at Backup, outside the app folder.
internal sealed class RollbackFailedException(string backup, Exception inner) : IOException("The previous version could not be restored.", inner)
{
    internal string Backup { get; } = backup;
}

internal sealed record WindowsUpdate(string Version, string SourceCommit, string Url, long Size, string Sha256, string Signature);

// Verified Windows updates. The maintainer signs windows-update.json with
// scripts/sign-windows-update.mjs; the app only holds the public key. A build with
// no tracked public key, such as a fork, keeps opening the releases page instead.
internal static partial class Updater
{
    internal const string ReleasesPage = "https://github.com/orkunisitmak/banana-studio/releases/latest";
    private const string FeedUrl = "https://github.com/orkunisitmak/banana-studio/releases/latest/download/windows-update.json";
    private const string AllowedUrlPrefix = "https://github.com/orkunisitmak/banana-studio/releases/download/";
    private const string ExecutableName = "BananaStudio.exe";
    private const string HealthyMarker = "healthy";
    private const long MaxArchiveBytes = 1024L * 1024 * 1024;
    private const long MaxExtractedBytes = 3L * 1024 * 1024 * 1024;
    private const int MaxManifestBytes = 64 * 1024;
    private static readonly TimeSpan HealthTimeout = TimeSpan.FromSeconds(90);
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(20) };
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    private static string UpdatesDirectory => Path.Combine(WorkspaceProcess.DataDirectory, "updates");
    private static string? stageReportingHealth;
    private static volatile string? stageInProgress;

    [GeneratedRegex(@"^\d+\.\d+\.\d+$")] private static partial Regex ReleaseVersion();
    [GeneratedRegex(@"^[0-9a-f]{64}$")] private static partial Regex Sha256Text();
    [GeneratedRegex(@"^[0-9a-f]{40}$")] private static partial Regex CommitText();

    internal static string? PublicKey
    {
        get
        {
            using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("BananaStudio.WindowsUpdatePublicKey.txt");
            if (stream == null) return null;
            using var reader = new StreamReader(stream);
            var key = reader.ReadToEnd().Trim();
            return key.Length == 0 ? null : key;
        }
    }

    internal static string? CurrentVersion => ReadRelease(AppContext.BaseDirectory)?.Version;

    private static byte[] SignedBytes(WindowsUpdate update) => Encoding.UTF8.GetBytes(string.Join('\n',
        "banana-studio-windows-update-v1", update.Version, update.SourceCommit, update.Url,
        update.Size.ToString(System.Globalization.CultureInfo.InvariantCulture), update.Sha256));

    private static bool SignatureIsValid(WindowsUpdate update, string publicKey)
    {
        try
        {
            using var key = ECDsa.Create();
            key.ImportSubjectPublicKeyInfo(Convert.FromBase64String(publicKey), out _);
            return key.KeySize == 256 && key.VerifyData(SignedBytes(update), Convert.FromBase64String(update.Signature), HashAlgorithmName.SHA256);
        }
        catch (Exception error) when (error is FormatException or CryptographicException or ArgumentException) { return false; }
    }

    internal static bool IsNewer(string candidate, string current)
    {
        if (!ReleaseVersion().IsMatch(candidate) || !ReleaseVersion().IsMatch(current)) return false;
        return Version.Parse(candidate) > Version.Parse(current);
    }

    // Every signed field is checked before any field is trusted or the archive is fetched.
    internal static string? Problem(WindowsUpdate? update, string publicKey)
    {
        if (update == null || update.Version == null || update.SourceCommit == null || update.Url == null || update.Sha256 == null || update.Signature == null) return "The update information is incomplete.";
        if (!SignatureIsValid(update, publicKey)) return "The update signature is not valid.";
        var name = $"Banana-Studio-{update.Version}-windows-x64.zip";
        if (!ReleaseVersion().IsMatch(update.Version) || !CommitText().IsMatch(update.SourceCommit) || !Sha256Text().IsMatch(update.Sha256)) return "The update information is not valid.";
        if (update.Url != $"{AllowedUrlPrefix}v{update.Version}/{name}") return "The update address is not expected.";
        if (update.Size < 1 || update.Size > MaxArchiveBytes) return "The update size is not expected.";
        return null;
    }

    internal static async Task<WindowsUpdate?> Check(string publicKey, string currentVersion, CancellationToken cancel)
    {
        using var response = await Http.GetAsync(FeedUrl, HttpCompletionOption.ResponseHeadersRead, cancel);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength > MaxManifestBytes) throw new InvalidDataException("The update information is too large.");
        var update = JsonSerializer.Deserialize<WindowsUpdate>(await response.Content.ReadAsStringAsync(cancel), JsonOptions);
        var problem = Problem(update, publicKey);
        if (problem != null) throw new InvalidDataException(problem);
        return IsNewer(update!.Version, currentVersion) ? update : null;
    }

    internal static async Task<string> Prepare(WindowsUpdate update, string publicKey, CancellationToken cancel)
    {
        var problem = Problem(update, publicKey);
        if (problem != null) throw new InvalidDataException(problem);
        RequireWritableInstall(AppContext.BaseDirectory);
        var stage = Path.Combine(UpdatesDirectory, Guid.NewGuid().ToString("N"));
        stageInProgress = stage;
        Directory.CreateDirectory(stage);
        try
        {
            var archive = Path.Combine(stage, "update.zip");
            using (var response = await Http.GetAsync(update.Url, HttpCompletionOption.ResponseHeadersRead, cancel))
            {
                response.EnsureSuccessStatusCode();
                await using var source = await response.Content.ReadAsStreamAsync(cancel);
                await using var target = new FileStream(archive, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                var buffer = new byte[81920];
                long total = 0;
                int read;
                while ((read = await source.ReadAsync(buffer, cancel)) > 0)
                {
                    total += read;
                    if (total > update.Size) throw new InvalidDataException("The downloaded file is larger than expected.");
                    await target.WriteAsync(buffer.AsMemory(0, read), cancel);
                }
            }
            await Task.Run(() => ExtractVerified(archive, update, Path.Combine(stage, "payload")), cancel);
            File.Delete(archive);
            return stage;
        }
        catch { stageInProgress = null; TryDeleteDirectory(stage); throw; }
    }

    // Hash and extraction use one handle that denies writes, so the checked bytes are the extracted bytes.
    internal static void ExtractVerified(string archive, WindowsUpdate update, string payload)
    {
        using var file = new FileStream(archive, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (file.Length != update.Size || !string.Equals(Convert.ToHexString(SHA256.HashData(file)), update.Sha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("The downloaded file failed verification.");
        file.Position = 0;
        using var zip = new ZipArchive(file, ZipArchiveMode.Read);
        var root = Path.GetFullPath(payload) + Path.DirectorySeparatorChar;
        long extracted = 0;
        foreach (var entry in zip.Entries)
        {
            var name = entry.FullName.Replace('\\', '/');
            if (name.StartsWith('/') || name.Contains(':') || name.Split('/').Contains("..")) throw new InvalidDataException("The update contains an unsafe path.");
            var target = Path.GetFullPath(Path.Combine(root, name.Replace('/', Path.DirectorySeparatorChar)));
            if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("The update contains an unsafe path.");
            if (name.EndsWith('/')) { Directory.CreateDirectory(target); continue; }
            extracted += entry.Length;
            if (extracted > MaxExtractedBytes) throw new InvalidDataException("The update is larger than expected.");
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            entry.ExtractToFile(target);
        }
        var app = PayloadApp(payload);
        var release = ReadRelease(app);
        if (release == null || release.Version != update.Version || release.SourceCommit != update.SourceCommit || !File.Exists(Path.Combine(app, ExecutableName)))
            throw new InvalidDataException("The update contents do not match its signed information.");
    }

    internal static string PayloadApp(string payload) => Path.Combine(payload, "Banana Studio");

    // The verified copy applies the swap, because the running files cannot replace themselves.
    internal static void StartApply(string stage)
    {
        var payloadApp = PayloadApp(Path.Combine(stage, "payload"));
        var start = new ProcessStartInfo(Path.Combine(payloadApp, ExecutableName)) { UseShellExecute = false, WorkingDirectory = payloadApp };
        start.ArgumentList.Add("--apply-update");
        start.ArgumentList.Add(Path.TrimEndingDirectorySeparator(AppContext.BaseDirectory));
        start.ArgumentList.Add(Environment.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture));
        start.ArgumentList.Add(stage);
        Process.Start(start)?.Dispose();
    }

    internal static int RunApply(string target, string processId, string stage)
    {
        try
        {
            if (!int.TryParse(processId, out var parent)) return 1;
            if (!IsOwnStage(stage)) return 1;
            // A process keeps its working directory locked. Inheriting the install folder would block the swap.
            Environment.CurrentDirectory = stage;
            WaitForExit(parent);
            var app = Path.Combine(target, ExecutableName);
            var ok = Apply(target, PayloadApp(Path.Combine(stage, "payload")), () =>
            {
                var process = Process.Start(new ProcessStartInfo(app) { UseShellExecute = false, WorkingDirectory = target, ArgumentList = { "--report-update-health", stage } });
                return () => { try { process?.Kill(true); process?.WaitForExit(10_000); } catch (Exception error) when (error is InvalidOperationException or System.ComponentModel.Win32Exception) { } };
            }, () => File.Exists(Path.Combine(stage, HealthyMarker)), HealthTimeout);
            if (!ok)
            {
                MessageBox.Show("The update could not start, so the previous version of Banana Studio was restored. Your gallery was not changed.", "Banana Studio");
                Process.Start(new ProcessStartInfo(app) { UseShellExecute = false, WorkingDirectory = target })?.Dispose();
            }
            return ok ? 0 : 1;
        }
        catch (RollbackFailedException error)
        {
            MessageBox.Show($"The update could not start, and the previous version could not be put back in its folder. It is safe here:\n{error.Backup}\n\nBanana Studio will now open from there. Your gallery was not changed.\n\nTo tidy up later, quit Banana Studio, delete this folder if it is still there:\n{target}\nand rename the safe copy to that name.", "Banana Studio");
            try { Process.Start(new ProcessStartInfo(Path.Combine(error.Backup, ExecutableName)) { UseShellExecute = false, WorkingDirectory = error.Backup })?.Dispose(); }
            catch (Exception launch) when (launch is System.ComponentModel.Win32Exception or InvalidOperationException) { }
            return 1;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            MessageBox.Show("The update could not be installed: " + error.Message, "Banana Studio");
            return 1;
        }
    }

    // Moves the install aside, copies the new files and keeps them only once the new
    // version reports a working workspace. Any failure puts the previous install back.
    // Rollback failures surface as RollbackFailedException, carrying the intact backup. The file
    // operations can be replaced only by the isolated test.
    internal static bool Apply(string target, string payloadApp, Func<Action> launch, Func<bool> healthy, TimeSpan timeout, Action<string>? delete = null, Action<string, string>? move = null)
    {
        delete ??= DeleteWithRetry;
        move ??= MoveWithRetry;
        var parent = Path.GetDirectoryName(target) ?? throw new IOException("The application folder is not expected.");
        var backup = Path.Combine(parent, Path.GetFileName(target) + ".previous-" + Guid.NewGuid().ToString("N"));
        move(target, backup);
        Action stop = () => { };
        try
        {
            CopyDirectory(payloadApp, target);
            stop = launch();
            var deadline = Stopwatch.StartNew();
            while (deadline.Elapsed < timeout)
            {
                if (healthy()) { TryDeleteDirectory(backup); return true; }
                Thread.Sleep(250);
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception or InvalidOperationException) { }
        stop();
        try { delete(target); move(backup, target); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { throw new RollbackFailedException(backup, error); }
        return false;
    }

    internal static void ReportHealthWhenReady(string[] args)
    {
        var index = Array.IndexOf(args, "--report-update-health");
        if (index >= 0 && index + 1 < args.Length && IsOwnStage(args[index + 1])) stageReportingHealth = args[index + 1];
    }

    // Called once the local workspace answers: the updater can then discard the old install.
    internal static void ReportHealthy()
    {
        if (stageReportingHealth != null) try { File.WriteAllText(Path.Combine(stageReportingHealth, HealthyMarker), "ok"); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    internal static void DiscardStage(string stage) { stageInProgress = null; TryDeleteDirectory(stage); }

    // A stage holds a full copy of the app, so finished ones must not accumulate.
    internal static void CleanFinishedStages()
    {
        if (!Directory.Exists(UpdatesDirectory)) return;
        foreach (var stage in Directory.GetDirectories(UpdatesDirectory))
            if (stage != stageInProgress && Guid.TryParseExact(Path.GetFileName(stage), "N", out _)) TryDeleteDirectory(stage);
    }

    private static bool IsOwnStage(string stage)
    {
        var parent = Path.GetDirectoryName(Path.GetFullPath(stage));
        return string.Equals(parent, Path.GetFullPath(UpdatesDirectory), StringComparison.OrdinalIgnoreCase) && Guid.TryParseExact(Path.GetFileName(stage), "N", out _);
    }

    private static void RequireWritableInstall(string install)
    {
        var parent = Path.GetDirectoryName(Path.TrimEndingDirectorySeparator(install)) ?? install;
        var probe = Path.Combine(parent, ".banana-update-" + Guid.NewGuid().ToString("N"));
        try { Directory.CreateDirectory(probe); Directory.Delete(probe); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { throw new IOException("Banana Studio needs a folder you can write to for automatic updates. Move it there or download the update manually."); }
    }

    private static void WaitForExit(int processId)
    {
        try { using var process = Process.GetProcessById(processId); process.WaitForExit(60_000); }
        catch (ArgumentException) { }
    }

    private static void MoveWithRetry(string source, string destination)
    {
        // The workspace and antivirus software can hold files for a moment after the app exits.
        for (var attempt = 0; ; attempt++)
        {
            try { Directory.Move(source, destination); return; }
            catch (Exception error) when (attempt < 60 && error is IOException or UnauthorizedAccessException) { Thread.Sleep(500); }
        }
    }

    private static void DeleteWithRetry(string directory)
    {
        for (var attempt = 0; Directory.Exists(directory); attempt++)
        {
            try { Directory.Delete(directory, true); }
            catch (Exception error) when (attempt < 60 && error is IOException or UnauthorizedAccessException) { Thread.Sleep(500); }
        }
    }

    private static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);
        foreach (var directory in Directory.GetDirectories(source, "*", SearchOption.AllDirectories)) Directory.CreateDirectory(Path.Combine(destination, Path.GetRelativePath(source, directory)));
        foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories)) File.Copy(file, Path.Combine(destination, Path.GetRelativePath(source, file)));
    }

    private static void TryDeleteDirectory(string directory)
    {
        try { Directory.Delete(directory, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    private sealed record ReleaseInfo(string Version, string SourceCommit);

    private static ReleaseInfo? ReadRelease(string directory)
    {
        try { return JsonSerializer.Deserialize<ReleaseInfo>(File.ReadAllText(Path.Combine(directory, "release.json")), JsonOptions); }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException) { return null; }
    }

    // Isolated checks with an ephemeral key. No network, maintainer key or real install is involved.
    internal static void Test()
    {
        static void Require(bool value, string name) { if (!value) throw new InvalidOperationException("Updater test failed: " + name); }
        using var pair = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var publicKey = Convert.ToBase64String(pair.ExportSubjectPublicKeyInfo());
        const string commit = "0123456789abcdef0123456789abcdef01234567";
        WindowsUpdate Signed(string version = "9.9.9", long size = 1, string sha = "", string? url = null)
        {
            var update = new WindowsUpdate(version, commit, url ?? $"{AllowedUrlPrefix}v{version}/Banana-Studio-{version}-windows-x64.zip", size, sha.Length == 0 ? new string('a', 64) : sha, "");
            return update with { Signature = Convert.ToBase64String(pair.SignData(SignedBytes(update), HashAlgorithmName.SHA256)) };
        }

        Require(Problem(Signed(), publicKey) == null, "valid");
        var valid = Signed();
        Require(Problem(valid with { Version = "9.9.8" }, publicKey) != null, "changed version");
        Require(Problem(valid with { SourceCommit = new string('b', 40) }, publicKey) != null, "changed commit");
        Require(Problem(valid with { Size = 2 }, publicKey) != null, "changed size");
        Require(Problem(valid with { Sha256 = new string('b', 64) }, publicKey) != null, "changed hash");
        Require(Problem(valid with { Url = "https://example.com/a.zip" }, publicKey) != null, "changed address");
        Require(Problem(valid with { Signature = "not base64" }, publicKey) != null, "malformed signature");
        Require(Problem(null, publicKey) != null, "missing");
        Require(Problem(valid with { Signature = null! }, publicKey) != null, "null field");
        Require(Problem(Signed(url: "https://example.com/Banana-Studio-9.9.9-windows-x64.zip"), publicKey) != null, "signed wrong address");
        Require(Problem(Signed(size: 0), publicKey) != null, "signed zero size");
        using (var other = ECDsa.Create(ECCurve.NamedCurves.nistP256)) Require(Problem(valid, Convert.ToBase64String(other.ExportSubjectPublicKeyInfo())) != null, "other key");
        Require(IsNewer("0.2.0", "0.1.8") && IsNewer("0.1.10", "0.1.9"), "newer");
        Require(!IsNewer("0.1.8", "0.1.8") && !IsNewer("0.1.7", "0.1.8") && !IsNewer("x", "0.1.8") && !IsNewer("0.2.0-beta", "0.1.8"), "not newer");

        var directory = Path.Combine(Path.GetTempPath(), "BananaStudio-update-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            string BuildZip(string name, Action<ZipArchive> fill)
            {
                var path = Path.Combine(directory, name);
                using var zip = ZipFile.Open(path, ZipArchiveMode.Create);
                fill(zip);
                return path;
            }
            static void Add(ZipArchive zip, string name, string text)
            {
                using var writer = new StreamWriter(zip.CreateEntry(name).Open());
                writer.Write(text);
            }
            WindowsUpdate Describe(string archive) => Signed(size: new FileInfo(archive).Length, sha: Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(archive))).ToLowerInvariant());
            var release = "{\"version\":\"9.9.9\",\"sourceCommit\":\"" + commit + "\"}";
            bool Rejected(string archive, WindowsUpdate update)
            {
                var output = Path.Combine(directory, Guid.NewGuid().ToString("N"));
                try { ExtractVerified(archive, update, output); return false; } catch (InvalidDataException) { return true; }
            }

            var good = BuildZip("good.zip", zip => { Add(zip, "Banana Studio/" + ExecutableName, "exe"); Add(zip, "Banana Studio/release.json", release); });
            var goodOutput = Path.Combine(directory, "good");
            ExtractVerified(good, Describe(good), goodOutput);
            Require(File.ReadAllText(Path.Combine(PayloadApp(goodOutput), ExecutableName)) == "exe", "extracted");
            Require(Rejected(good, Describe(good) with { Sha256 = new string('b', 64) }), "wrong hash");
            Require(Rejected(good, Describe(good) with { Size = 1 }), "wrong size");
            var climb = BuildZip("climb.zip", zip => Add(zip, "../outside.txt", "x"));
            Require(Rejected(climb, Describe(climb)) && !File.Exists(Path.Combine(directory, "outside.txt")), "path traversal");
            var stale = BuildZip("stale.zip", zip => { Add(zip, "Banana Studio/" + ExecutableName, "exe"); Add(zip, "Banana Studio/release.json", "{\"version\":\"1.0.0\",\"sourceCommit\":\"" + commit + "\"}"); });
            Require(Rejected(stale, Describe(stale)), "other version inside");

            string Install(string name, string marker)
            {
                var folder = Path.Combine(directory, name);
                Directory.CreateDirectory(Path.Combine(folder, "sub"));
                File.WriteAllText(Path.Combine(folder, "sub", "file.txt"), marker);
                return folder;
            }
            string Marker(string folder) => File.ReadAllText(Path.Combine(folder, "sub", "file.txt"));
            bool Backups(string name) => Directory.GetDirectories(directory, name + ".previous-*").Length > 0;

            var kept = Install("kept", "old");
            Require(Apply(kept, Install("keptNew", "new"), () => () => { }, () => true, TimeSpan.FromSeconds(5)), "healthy apply");
            Require(Marker(kept) == "new" && !Backups("kept"), "healthy result");

            var restored = Install("restored", "old");
            var stopped = false;
            Require(!Apply(restored, Install("restoredNew", "new"), () => () => stopped = true, () => false, TimeSpan.FromMilliseconds(300)), "unhealthy apply");
            Require(Marker(restored) == "old" && stopped && !Backups("restored"), "unhealthy restored");

            var refused = Install("refused", "old");
            Require(!Apply(refused, Install("refusedNew", "new"), () => throw new InvalidOperationException("no start"), () => true, TimeSpan.FromSeconds(5)), "failed launch");
            Require(Marker(refused) == "old" && !Backups("refused"), "failed launch restored");

            // The last rollback step fails: the backup must survive and be reported, never deleted.
            void RollbackFails(string name, Action<string>? delete, Action<string, string>? move)
            {
                var install = Install(name, "old");
                var stoppedNew = false;
                RollbackFailedException? failure = null;
                try { Apply(install, Install(name + "New", "new"), () => () => stoppedNew = true, () => false, TimeSpan.FromMilliseconds(300), delete, move); }
                catch (RollbackFailedException error) { failure = error; }
                Require(failure != null && stoppedNew, name + " reported");
                Require(Directory.Exists(failure!.Backup) && Marker(failure.Backup) == "old", name + " backup intact");
            }
            var moves = 0;
            RollbackFails("moveBack", null, (source, destination) => { if (++moves == 2) throw new IOException("locked"); Directory.Move(source, destination); });
            Require(!Directory.Exists(Path.Combine(directory, "moveBack")), "moveBack left no partial install");
            RollbackFails("deleteNew", _ => throw new UnauthorizedAccessException("locked"), null);
            Require(Marker(Path.Combine(directory, "deleteNew")) == "new", "deleteNew kept the new copy in place");
        }
        finally { TryDeleteDirectory(directory); }
    }

    // Lets CI prove that a manifest from the Node signing script verifies in the app.
    internal static void TestManifest(string manifest, string publicKeyFile)
    {
        var update = JsonSerializer.Deserialize<WindowsUpdate>(File.ReadAllText(manifest), JsonOptions);
        var problem = Problem(update, File.ReadAllText(publicKeyFile).Trim());
        if (problem != null) throw new InvalidDataException(problem);
    }
}
