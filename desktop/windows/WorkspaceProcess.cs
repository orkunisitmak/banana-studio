using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace BananaStudio;

internal sealed class WorkspaceProcess : IDisposable
{
    internal static string DataDirectory => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Banana Studio");
    private Process? process;
    private readonly SemaphoreSlim writer = new(1, 1);
    private bool closing;
    internal event Action? Failed;
    internal async Task<(Uri Origin, string Bootstrap)> Start()
    {
        var root = AppContext.BaseDirectory;
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        Directory.CreateDirectory(DataDirectory);
        var start = new ProcessStartInfo(Path.Combine(root, "runtime", "node.exe"))
        {
            WorkingDirectory = Path.Combine(root, "workspace"), UseShellExecute = false,
            CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardInputEncoding = new UTF8Encoding(false), StandardOutputEncoding = Encoding.UTF8
        };
        // Never inherit provider keys, NODE_OPTIONS, proxies or other shell configuration.
        start.Environment.Clear();
        foreach (var key in new[] { "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA" })
            if (Environment.GetEnvironmentVariable(key) is { } value) start.Environment[key] = value;
        start.ArgumentList.Add(Path.Combine(root, "workspace", "server.mjs"));
        process = new Process { StartInfo = start, EnableRaisingEvents = true };
        process.Exited += (_, _) => { if (!closing) Failed?.Invoke(); };
        if (!process.Start()) throw new IOException("The local workspace could not start.");
        // Discard diagnostics; provider errors must not persist prompts, media or keys.
        _ = Drain(process.StandardError);
        await Send(new { dataDirectory = DataDirectory, webRoot = Path.Combine(root, "workspace", "web"), bootstrap = token, keys = KeyVault.All() });
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        while (await process.StandardOutput.ReadLineAsync(timeout.Token) is { } line)
        {
            if (line.Length > 256000) throw new InvalidDataException();
            using var message = JsonDocument.Parse(line);
            if (message.RootElement.GetProperty("event").GetString() != "ready") continue;
            if (!Uri.TryCreate(message.RootElement.GetProperty("origin").GetString(), UriKind.Absolute, out var origin) || origin.Scheme != "http" || origin.Host != "127.0.0.1" || origin.IsDefaultPort) throw new InvalidDataException();
            // Keep reading stdout: a full pipe blocks Node's console writes and stalls the server.
            _ = Drain(process.StandardOutput);
            return (origin, token);
        }
        throw new IOException("The local workspace did not become ready.");
    }
    private static async Task Drain(StreamReader stream) { try { var buffer = new char[4096]; while (await stream.ReadAsync(buffer) > 0) { } } catch (IOException) { } }
    private async Task Send(object value)
    {
        await writer.WaitAsync();
        try { if (process == null) throw new IOException(); await process.StandardInput.WriteLineAsync(JsonSerializer.Serialize(value)); await process.StandardInput.FlushAsync(); }
        finally { writer.Release(); }
    }
    internal Task RefreshKeys() => Send(new { action = "keys", keys = KeyVault.All() });
    public void Dispose()
    {
        closing = true;
        if (process == null) return;
        try { process.StandardInput.Close(); if (!process.WaitForExit(3000)) process.Kill(true); }
        catch (InvalidOperationException) { }
        finally { process.Dispose(); process = null; }
    }
}
