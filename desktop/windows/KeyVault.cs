using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace BananaStudio;

internal static class KeyVault
{
    internal static readonly (string Name, string Label)[] Providers = [
        ("OPENAI_API_KEY", "OpenAI"), ("OPENROUTER_API_KEY", "OpenRouter"),
        ("GEMINI_API_KEY", "Google Gemini"), ("FAL_KEY", "fal.ai"),
        ("EVOLINK_API_KEY", "EvoLink"), ("YOUTUBE_API_KEY", "YouTube Data API"),
        ("LOCAL_API_KEY", "Local API key")
    ];
    internal static readonly (string Name, string Label, string DefaultValue)[] LocalSettings = [
        ("LOCAL_API_BASE_URL", "Local base URL", "http://localhost:20128/v1"),
        ("LOCAL_TEXT_MODEL", "Local text model ID", "cx/gpt-6.1-sol"),
        ("LOCAL_IMAGE_MODEL", "Local image model ID", "cx/gpt-image-2.5")
    ];
    internal sealed class InvalidLocalBaseUrlException : ArgumentException
    {
        internal InvalidLocalBaseUrlException() : base("Local base URL must be an absolute http:// or https:// URL with a host and no credentials, query or fragment.") { }
    }
    internal sealed class InvalidLocalModelException : ArgumentException
    {
        internal InvalidLocalModelException() : base("Local text and image model IDs must be at most 200 characters and contain no whitespace or control characters.") { }
    }
    internal static string? ValidateSetting(string name, string? value)
    {
        value = value?.Trim();
        if (string.IsNullOrEmpty(value)) return null;
        if (name == "LOCAL_API_BASE_URL")
        {
            if (value.Any(c => char.IsWhiteSpace(c) || char.IsControl(c)) || value.Contains('\\') || value.Contains('?') || value.Contains('#') ||
                (!value.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !value.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) ||
                !Uri.TryCreate(value, UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https") ||
                string.IsNullOrEmpty(uri.Host) || !string.IsNullOrEmpty(uri.UserInfo) || uri.Port is < 1 or > 65535 ||
                value[(value.IndexOf("://", StringComparison.Ordinal) + 3)..].Split('/')[0].Contains('@'))
                throw new InvalidLocalBaseUrlException();
        }
        else if (value.Length > 200 || value.Any(c => char.IsWhiteSpace(c) || char.IsControl(c))) throw new InvalidLocalModelException();
        Validate(value);
        return value;
    }
    internal static void Validate(string? value)
    {
        if (value != null && (Encoding.UTF8.GetByteCount(value) > 2560 || value.Contains('\n') || value.Contains('\r')))
            throw new ArgumentException("A key or configuration value is too long or contains a line break.");
    }
    private const string Prefix = "com.bananastudio.provider-keys/";
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential
    {
        public uint Flags, Type;
        public string TargetName;
        public string? Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist, AttributeCount;
        public IntPtr Attributes;
        public string? TargetAlias, UserName;
    }
    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool ReadNative(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool WriteNative(ref Credential credential, uint flags);
    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool DeleteNative(string target, uint type, uint flags);
    [DllImport("advapi32.dll")] private static extern void CredFree(IntPtr credential);

    internal static string? Read(string name, string prefix = Prefix)
    {
        if (!ReadNative(prefix + name, 1, 0, out var pointer))
        {
            if (Marshal.GetLastWin32Error() == 1168) return null;
            throw new Win32Exception("Windows Credential Manager is unavailable.");
        }
        try
        {
            var credential = Marshal.PtrToStructure<Credential>(pointer);
            if (credential.CredentialBlobSize > 2560) throw new InvalidDataException();
            var bytes = new byte[credential.CredentialBlobSize];
            Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
            try { return Encoding.UTF8.GetString(bytes); }
            finally { Array.Clear(bytes); }
        }
        finally { CredFree(pointer); }
    }
    internal static void Save(string name, string? value, string prefix = Prefix)
    {
        // Nonsecret settings share the vault so startup and refresh use the same private pipe.
        if (LocalSettings.Any(setting => setting.Name == name)) value = ValidateSetting(name, value);
        Validate(value);
        if (string.IsNullOrEmpty(value))
        {
            if (!DeleteNative(prefix + name, 1, 0) && Marshal.GetLastWin32Error() != 1168) throw new Win32Exception("The key could not be removed.");
            return;
        }
        var bytes = Encoding.UTF8.GetBytes(value);
        try
        {
            var blob = Marshal.AllocHGlobal(bytes.Length);
            try
            {
                Marshal.Copy(bytes, 0, blob, bytes.Length);
                var credential = new Credential { Type = 1, TargetName = prefix + name, CredentialBlobSize = (uint)bytes.Length, CredentialBlob = blob, Persist = 2, UserName = Environment.UserName };
                if (!WriteNative(ref credential, 0)) throw new Win32Exception("The key could not be saved.");
            }
            finally { Marshal.Copy(new byte[bytes.Length], 0, blob, bytes.Length); Marshal.FreeHGlobal(blob); }
        }
        finally { Array.Clear(bytes); }
    }
    internal static Dictionary<string, string> All(string prefix = Prefix)
    {
        var values = Providers.Select(p => (p.Name, Value: Read(p.Name, prefix))).Where(p => p.Value != null).ToDictionary(p => p.Name, p => p.Value!);
        var settings = LocalSettings.Select(setting => (setting.Name, setting.DefaultValue, Value: Read(setting.Name, prefix))).ToArray();
        // Existing installations must not enable localhost routing until a local value is saved.
        if (values.ContainsKey("LOCAL_API_KEY") || settings.Any(setting => setting.Value != null))
            foreach (var setting in settings) values[setting.Name] = ValidateSetting(setting.Name, setting.Value) ?? setting.DefaultValue;
        return values;
    }
    internal static void Test()
    {
        var prefix = "com.bananastudio.test/" + Guid.NewGuid() + "/";
        ValidateLocalSettings();
        try
        {
            Save("fixture", "synthetic-test-only", prefix);
            if (Read("fixture", prefix) != "synthetic-test-only") throw new InvalidOperationException();
            Save("fixture", null, prefix);
            if (Read("fixture", prefix) != null) throw new InvalidOperationException();
            var defaults = All(prefix);
            if (defaults.Keys.Any(name => name.StartsWith("LOCAL_", StringComparison.Ordinal))) throw new InvalidOperationException();
            Save("LOCAL_API_KEY", "synthetic-local-test-only", prefix);
            defaults = All(prefix);
            if (LocalSettings.Any(setting => defaults[setting.Name] != setting.DefaultValue)) throw new InvalidOperationException();
            foreach (var setting in LocalSettings) Save(setting.Name, setting.Name == "LOCAL_API_BASE_URL" ? "https://example.invalid/custom/v1" : "custom/model-id", prefix);
            var configured = All(prefix);
            if (configured["LOCAL_API_KEY"] != "synthetic-local-test-only" || configured["LOCAL_API_BASE_URL"] != "https://example.invalid/custom/v1" ||
                configured["LOCAL_TEXT_MODEL"] != "custom/model-id" || configured["LOCAL_IMAGE_MODEL"] != "custom/model-id") throw new InvalidOperationException();
            Save("LOCAL_API_KEY", null, prefix);
            if (All(prefix).ContainsKey("LOCAL_API_KEY") || All(prefix)["LOCAL_API_BASE_URL"] != "https://example.invalid/custom/v1") throw new InvalidOperationException();
            foreach (var setting in LocalSettings) Save(setting.Name, " ", prefix);
            defaults = All(prefix);
            if (defaults.Keys.Any(name => name.StartsWith("LOCAL_", StringComparison.Ordinal))) throw new InvalidOperationException();
            foreach (var setting in LocalSettings)
            {
                Save(setting.Name, setting.DefaultValue, prefix);
                defaults = All(prefix);
                if (defaults.ContainsKey("LOCAL_API_KEY") || LocalSettings.Any(item => defaults[item.Name] != item.DefaultValue)) throw new InvalidOperationException();
                Save(setting.Name, null, prefix);
            }
        }
        finally
        {
            Save("fixture", null, prefix); Save("LOCAL_API_KEY", null, prefix);
            foreach (var setting in LocalSettings) Save(setting.Name, null, prefix);
        }
    }
    internal static void ValidateLocalSettings()
    {
        foreach (var value in new[] { "http://localhost:20128/v1", "https://example.invalid/custom/v1/", "http://127.0.0.1:8080/v1", "http://[::1]:20128/v1" })
            if (ValidateSetting("LOCAL_API_BASE_URL", " " + value + " ") != value) throw new InvalidOperationException();
        foreach (var value in new[] { "localhost:20128/v1", "/v1", "ftp://localhost/v1", "http:///v1", "http://user:password@localhost/v1", "http://@localhost/v1",
            "http://localhost/v1?", "http://localhost/v1?token=synthetic", "http://localhost/v1#", "http://localhost/v1#fragment", "http://local host/v1", "http://localhost:65536/v1", "http://localhost:0/v1", "http://localhost\\v1" })
        {
            try { ValidateSetting("LOCAL_API_BASE_URL", value); throw new InvalidOperationException(); }
            catch (InvalidLocalBaseUrlException) { }
        }
        if (ValidateSetting("LOCAL_API_BASE_URL", " ") != null || ValidateSetting("LOCAL_TEXT_MODEL", " any/custom-model ") != "any/custom-model" ||
            ValidateSetting("LOCAL_IMAGE_MODEL", "cx/gpt-5.6-sol-image/terra-image/luna-image") != "cx/gpt-5.6-sol-image/terra-image/luna-image") throw new InvalidOperationException();
        foreach (var value in new[] { "line\nbreak", "line\rbreak", "model id", "model\tid", "model\0id", "model\u007fid", "model\u0085id", new string('a', 201), string.Concat(Enumerable.Repeat("😀", 101)) })
        {
            try { ValidateSetting("LOCAL_TEXT_MODEL", value); throw new InvalidOperationException(); }
            catch (InvalidLocalModelException) { }
        }
        if (ValidateSetting("LOCAL_TEXT_MODEL", new string('a', 200))?.Length != 200) throw new InvalidOperationException();
    }
}
