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
        ("CLAUDE_CODE_OAUTH_TOKEN", "Claude plan token")
    ];
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
        if (string.IsNullOrEmpty(value))
        {
            if (!DeleteNative(prefix + name, 1, 0) && Marshal.GetLastWin32Error() != 1168) throw new Win32Exception("The key could not be removed.");
            return;
        }
        var bytes = Encoding.UTF8.GetBytes(value);
        try
        {
            if (bytes.Length > 2560 || value.Contains('\n') || value.Contains('\r')) throw new ArgumentException("The API key is invalid or too long.");
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
    internal static Dictionary<string, string> All() => Providers.Select(p => (p.Name, Value: Read(p.Name))).Where(p => p.Value != null).ToDictionary(p => p.Name, p => p.Value!);
    internal static void Test()
    {
        var prefix = "com.bananastudio.test/" + Guid.NewGuid() + "/";
        try
        {
            Save("fixture", "synthetic-test-only", prefix);
            if (Read("fixture", prefix) != "synthetic-test-only") throw new InvalidOperationException();
            Save("fixture", null, prefix);
            if (Read("fixture", prefix) != null) throw new InvalidOperationException();
        }
        finally { Save("fixture", null, prefix); }
    }
}
