namespace BananaStudio;

internal static class WebViewSessions
{
    /// <summary>
    /// Creates a fresh WebView profile folder and removes stale ones. Called only after Program owns
    /// the single-instance mutex. The folder is a disposable WebView profile root, never the SQLite or media directory.
    /// </summary>
    internal static string Create(string dataDirectory)
    {
        var root = Path.Combine(dataDirectory, "webview-sessions");
        Directory.CreateDirectory(root);
        if (!PlainAncestors(root)) throw new IOException("The browser session directory must not be a link.");
        Cleanup(root);
        var profile = Path.Combine(root, Guid.NewGuid().ToString("D"));
        Directory.CreateDirectory(profile);
        return profile;
    }
    /// <summary>True when no folder from <paramref name="directory"/> up to the root is a link or junction.</summary>
    private static bool PlainAncestors(string directory)
    {
        for (var entry = new DirectoryInfo(directory); entry != null; entry = entry.Parent)
            if ((entry.Attributes & FileAttributes.ReparsePoint) != 0) return false;
        return true;
    }
    /// <summary>True when nothing inside the folder is a link or junction.</summary>
    private static bool PlainTree(DirectoryInfo directory)
    {
        foreach (var entry in directory.EnumerateFileSystemInfos())
        {
            if ((entry.Attributes & FileAttributes.ReparsePoint) != 0) return false;
            if (entry is DirectoryInfo child && !PlainTree(child)) return false;
        }
        return true;
    }
    /// <summary>Deletes stale GUID-named profiles; anything else, or anything containing a link, is kept.</summary>
    private static void Cleanup(string root)
    {
        foreach (var directory in new DirectoryInfo(root).EnumerateDirectories())
        {
            if (!Guid.TryParseExact(directory.Name, "D", out _)) continue;
            try
            {
                if ((directory.Attributes & FileAttributes.ReparsePoint) != 0 || !PlainTree(directory)) continue;
                directory.Delete(true);
            }
            catch (IOException) { } // A browser process from a previous crash may still hold files.
            catch (UnauthorizedAccessException) { }
        }
    }
    /// <summary>Self-test for <c>--test-webview-sessions</c>, using a synthetic temporary folder.</summary>
    internal static void Test()
    {
        var fixture = Path.Combine(Path.GetTempPath(), "banana-sessions-test-" + Guid.NewGuid());
        try
        {
            var root = Path.Combine(fixture, "webview-sessions");
            var stale = Path.Combine(root, Guid.NewGuid().ToString("D"));
            Directory.CreateDirectory(stale); File.WriteAllText(Path.Combine(stale, "synthetic"), "fixture");
            var unrelated = Path.Combine(root, "keep-this-folder"); Directory.CreateDirectory(unrelated);
            var gallery = Path.Combine(fixture, "media"); Directory.CreateDirectory(gallery);
            File.WriteAllText(Path.Combine(fixture, "workspace.sqlite"), "synthetic fixture");
            var current = Create(fixture);
            if (Directory.Exists(stale) || !Directory.Exists(current) || !Directory.Exists(unrelated) || !Directory.Exists(gallery) || !File.Exists(Path.Combine(fixture, "workspace.sqlite"))) throw new InvalidOperationException();
            // The cleanup must never follow an app-named session link to other data.
            var outside = Path.Combine(fixture, "outside"); Directory.CreateDirectory(outside);
            File.WriteAllText(Path.Combine(outside, "keep"), "synthetic");
            try
            {
                var linked = Path.Combine(root, Guid.NewGuid().ToString("D"));
                Directory.CreateSymbolicLink(linked, outside);
                _ = Create(fixture);
                if (!File.Exists(Path.Combine(outside, "keep")) || !Directory.Exists(linked)) throw new InvalidOperationException();
                Directory.Delete(linked);
            }
            catch (UnauthorizedAccessException) { } // Symlink creation requires permission on some Windows versions.
        }
        finally { Directory.Delete(fixture, true); }
    }
}
