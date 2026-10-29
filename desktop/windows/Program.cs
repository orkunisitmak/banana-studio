using System.Diagnostics;
using System.Text.Json;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace BananaStudio;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Contains("--test-vault")) { try { KeyVault.Test(); return 0; } catch { return 1; } }
        if (args.Contains("--test-window-placement")) { try { WindowPlacement.Test(); return 0; } catch { return 1; } }
        ApplicationConfiguration.Initialize();
        using var instance = new Mutex(true, "Local\\BananaStudio.Workspace", out var first);
        if (!first) { MessageBox.Show("Banana Studio is already running. Open its existing window.", "Banana Studio"); return 0; }
        Application.Run(new StudioWindow());
        return 0;
    }
}

internal sealed class StudioWindow : Form
{
    private readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(13, 17, 23) };
    private readonly WorkspaceProcess workspace = new();
    private Uri? origin;
    private string? profile;
    private Rectangle normalWindowBounds;
    private bool placementReady;
    private bool fullscreenTransition;
    private readonly Label status = new() { Text = "Opening your local workspace…", ForeColor = Color.LightGray, BackColor = Color.FromArgb(13, 17, 23), Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter };

    internal StudioWindow()
    {
        Text = "Banana Studio"; Width = 1400; Height = 900; MinimumSize = new Size(760, 560);
        StartPosition = FormStartPosition.CenterScreen; BackColor = Color.FromArgb(13, 17, 23);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        HandleCreated += (_, _) => { var dark = 1; _ = DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int)); };
        var menu = new MenuStrip { BackColor = BackColor, ForeColor = Color.Gainsboro, Renderer = new ToolStripProfessionalRenderer(new DarkMenuColors()) };
        var file = new ToolStripMenuItem("File");
        var keyItem = new ToolStripMenuItem("Provider API Keys…", null, async (_, _) => await ShowKeys()) { ShortcutKeys = Keys.Control | Keys.Oemcomma, ShortcutKeyDisplayString = "Ctrl+," };
        file.DropDownItems.Add(keyItem);
        file.DropDownItems.Add("Open Local Data Folder", null, (_, _) => Process.Start(new ProcessStartInfo(WorkspaceProcess.DataDirectory) { UseShellExecute = true }));
        file.DropDownItems.Add("Check for Updates…", null, (_, _) => OpenExternal("https://github.com/orkunisitmak/banana-studio/releases/latest"));
        file.DropDownItems.Add("Exit", null, (_, _) => Close());
        var view = new ToolStripMenuItem("View");
        view.DropDownItems.Add("Full Screen (F11, Esc to exit)", null, (_, _) => ToggleFullScreen());
        foreach (var item in file.DropDownItems.Cast<ToolStripItem>().Concat(view.DropDownItems.Cast<ToolStripItem>())) item.ForeColor = Color.Gainsboro;
        menu.Items.Add(file); menu.Items.Add(view); MainMenuStrip = menu;
        Controls.Add(web); Controls.Add(status); Controls.Add(menu);
        Shown += async (_, _) =>
        {
            ApplyWindowBounds(WindowPlacement.Load(WorkspaceProcess.DataDirectory) ?? Bounds);
            placementReady = true; CaptureNormalWindowBounds();
            await StartWorkspace();
        };
        LocationChanged += (_, _) => CaptureNormalWindowBounds();
        SizeChanged += (_, _) => CaptureNormalWindowBounds();
        DpiChanged += (_, _) => { if (placementReady) BeginInvoke(KeepWindowReachable); };
        FormClosing += (_, _) =>
        {
            CaptureNormalWindowBounds();
            if (placementReady) WindowPlacement.Save(WorkspaceProcess.DataDirectory, normalWindowBounds);
        };
        FormClosed += (_, _) => { workspace.Dispose(); web.Dispose(); if (profile != null) { try { Directory.Delete(profile, true); } catch (IOException) { } catch (UnauthorizedAccessException) { } } };
        workspace.Failed += () => { if (!IsDisposed && IsHandleCreated) BeginInvoke(() => ShowFailure("The local workspace stopped. Reopen Banana Studio. Your saved gallery is kept on this PC.")); };
    }
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
    private void CaptureNormalWindowBounds()
    {
        if (placementReady && !fullscreenTransition && FormBorderStyle != FormBorderStyle.None && WindowState == FormWindowState.Normal) normalWindowBounds = Bounds;
    }
    private void ApplyWindowBounds(Rectangle bounds)
    {
        var fitted = WindowPlacement.Constrain(bounds, Screen.AllScreens.OrderByDescending(screen => screen.Primary).Select(screen => screen.WorkingArea).ToArray(), new Size(760, 560));
        MinimumSize = new Size(Math.Min(760, fitted.Width), Math.Min(560, fitted.Height));
        Bounds = fitted;
    }
    private void KeepWindowReachable()
    {
        if (IsDisposed || !placementReady || FormBorderStyle == FormBorderStyle.None || WindowState != FormWindowState.Normal) return;
        ApplyWindowBounds(Bounds); CaptureNormalWindowBounds();
    }
    protected override void WndProc(ref Message message)
    {
        base.WndProc(ref message);
        // WM_DISPLAYCHANGE also covers a disconnected external monitor.
        if (message.Msg == 0x007E && placementReady && IsHandleCreated && !IsDisposed) BeginInvoke(KeepWindowReachable);
    }
    private sealed class DarkMenuColors : ProfessionalColorTable
    {
        private static Color Background => Color.FromArgb(22, 27, 34);
        public override Color ToolStripDropDownBackground => Background;
        public override Color ImageMarginGradientBegin => Background;
        public override Color ImageMarginGradientMiddle => Background;
        public override Color ImageMarginGradientEnd => Background;
        public override Color MenuItemSelected => Color.FromArgb(42, 47, 57);
        public override Color MenuItemSelectedGradientBegin => MenuItemSelected;
        public override Color MenuItemSelectedGradientEnd => MenuItemSelected;
        public override Color MenuItemPressedGradientBegin => MenuItemSelected;
        public override Color MenuItemPressedGradientMiddle => MenuItemSelected;
        public override Color MenuItemPressedGradientEnd => MenuItemSelected;
        public override Color MenuBorder => Color.FromArgb(55, 65, 81);
        public override Color MenuItemBorder => MenuBorder;
    }
    private bool Local(string? value) => Uri.TryCreate(value, UriKind.Absolute, out var uri) && origin != null && uri.Scheme == origin.Scheme && uri.Host == origin.Host && uri.Port == origin.Port;
    private void OpenExternal(string url) { if (Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == "https" && string.IsNullOrEmpty(uri.UserInfo)) Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
    private void ShowFailure(string message) { status.Text = message; status.Visible = true; status.BringToFront(); }
    private async Task StartWorkspace()
    {
        try
        {
            // A fresh browser profile matches the Mac shell's nonpersistent session.
            // Durable user data lives in the shared SQLite workspace, never here.
            profile = Path.Combine(WorkspaceProcess.DataDirectory, "webview-sessions", Guid.NewGuid().ToString());
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            await web.EnsureCoreWebView2Async(environment);
            var core = web.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.Profile.PreferredColorScheme = CoreWebView2PreferredColorScheme.Dark;
            core.NavigationStarting += (_, args) => { if (Local(args.Uri) || args.Uri == "about:blank" || (args.Uri.StartsWith("blob:") && Local(core.Source))) return; args.Cancel = true; if (args.IsUserInitiated) OpenExternal(args.Uri); };
            core.NewWindowRequested += (_, args) => { args.Handled = true; if (args.IsUserInitiated) OpenExternal(args.Uri); };
            core.PermissionRequested += (_, args) => { args.State = CoreWebView2PermissionState.Deny; };
            core.WebMessageReceived += async (_, args) =>
            {
                if (!Local(args.Source)) return;
                try
                {
                    using var value = JsonDocument.Parse(args.WebMessageAsJson);
                    var action = value.RootElement.GetProperty("action").GetString();
                    if (action == "keys") await ShowKeys();
                    if (action == "lock") Close();
                }
                catch (JsonException) { } catch (KeyNotFoundException) { }
            };
            core.DownloadStarting += (_, args) =>
            {
                var uri = args.DownloadOperation.Uri;
                if (!Local(uri) && !(uri.StartsWith("blob:") && Local(core.Source))) { args.Cancel = true; return; }
                using var save = new SaveFileDialog { FileName = Path.GetFileName(args.ResultFilePath), OverwritePrompt = true };
                if (save.ShowDialog(this) == DialogResult.OK) { args.ResultFilePath = save.FileName; args.Handled = true; } else args.Cancel = true;
            };
            web.KeyDown += (_, args) =>
            {
                if (args.KeyCode == Keys.F11) { args.Handled = args.SuppressKeyPress = true; BeginInvoke(ToggleFullScreen); }
                if (args.KeyCode == Keys.Escape && FormBorderStyle == FormBorderStyle.None) BeginInvoke(ToggleFullScreen);
                if (args.Control && args.KeyCode == Keys.Oemcomma) { args.Handled = args.SuppressKeyPress = true; BeginInvoke(async () => await ShowKeys()); }
                // Editing shortcuts remain native WebView2 actions so clipboard images,
                // Unicode text, undo and selection retain real clipboard semantics.
            };
            var ready = await workspace.Start(); origin = ready.Origin;
            core.NavigationCompleted += (_, args) => { if (args.IsSuccess && Local(core.Source)) status.Visible = false; else if (!args.IsSuccess) ShowFailure("The workspace could not open. Reopen Banana Studio."); };
            var request = environment.CreateWebResourceRequest(new Uri(origin, "/local/bootstrap").AbsoluteUri, "GET", null, "X-Banana-Bootstrap: " + ready.Bootstrap + "\r\n");
            core.NavigateWithWebResourceRequest(request);
        }
        catch (WebView2RuntimeNotFoundException) { ShowFailure("Microsoft Edge WebView2 Runtime is required. Install it from microsoft.com/edge/webview2, then reopen Banana Studio."); }
        catch { workspace.Dispose(); ShowFailure("The local workspace could not start. Reopen Banana Studio. Your saved gallery is kept on this PC."); }
    }
    private FormBorderStyle previousBorder;
    private FormWindowState previousState;
    private Rectangle previousBounds;
    private void ToggleFullScreen()
    {
        CaptureNormalWindowBounds(); fullscreenTransition = true;
        try
        {
            if (FormBorderStyle != FormBorderStyle.None) { previousBorder = FormBorderStyle; previousState = WindowState; previousBounds = Bounds; WindowState = FormWindowState.Normal; FormBorderStyle = FormBorderStyle.None; MainMenuStrip!.Visible = false; Bounds = Screen.FromControl(this).Bounds; }
            else { FormBorderStyle = previousBorder; Bounds = previousBounds; WindowState = previousState; MainMenuStrip!.Visible = true; }
        }
        finally { fullscreenTransition = false; CaptureNormalWindowBounds(); }
    }
    private bool keysOpen;
    private async Task ShowKeys()
    {
        if (keysOpen || origin == null) return;
        keysOpen = true;
        try
        {
            using var dialog = new Form { Text = "Provider API Keys", Width = 670, Height = 480, StartPosition = FormStartPosition.CenterParent, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false, BackColor = Color.FromArgb(22, 27, 34), ForeColor = Color.Gainsboro };
            var grid = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(20), ColumnCount = 3, RowCount = 8, AutoSize = true };
            var info = new Label { Text = "Add only the providers you use. OpenRouter covers text, images and supported Seedance video; fal.ai covers images and video. Select routes in AI settings. Keys stay in Windows Credential Manager. Blank fields keep saved keys. Remove clears a key.", AutoSize = true, MaximumSize = new Size(600, 0) };
            grid.Controls.Add(info, 0, 0); grid.SetColumnSpan(info, 3);
            var rows = new List<(string Name, TextBox Field, CheckBox Remove)>();
            var row = 1;
            foreach (var provider in KeyVault.Providers)
            {
                var field = new TextBox { Width = 300, UseSystemPasswordChar = true, BackColor = Color.FromArgb(13, 17, 23), ForeColor = Color.Gainsboro, BorderStyle = BorderStyle.FixedSingle, PlaceholderText = KeyVault.Read(provider.Name) != null ? "Saved in Credential Manager" : "Paste your API key" };
                var remove = new CheckBox { Text = "Remove", AutoSize = true };
                grid.Controls.Add(new Label { Text = provider.Label, AutoSize = true, Anchor = AnchorStyles.Left }, 0, row);
                grid.Controls.Add(field, 1, row); grid.Controls.Add(remove, 2, row++); rows.Add((provider.Name, field, remove));
            }
            var buttons = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.RightToLeft, Dock = DockStyle.Fill };
            var save = new Button { Text = "Save", DialogResult = DialogResult.OK }; var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel };
            buttons.Controls.Add(save); buttons.Controls.Add(cancel); grid.Controls.Add(buttons, 0, row); grid.SetColumnSpan(buttons, 3);
            dialog.Controls.Add(grid); dialog.AcceptButton = save; dialog.CancelButton = cancel;
            if (dialog.ShowDialog(this) != DialogResult.OK) return;
            foreach (var item in rows) { if (item.Remove.Checked) KeyVault.Save(item.Name, null); else if (!string.IsNullOrWhiteSpace(item.Field.Text)) KeyVault.Save(item.Name, item.Field.Text.Trim()); item.Field.Clear(); }
            await workspace.RefreshKeys();
        }
        catch { MessageBox.Show(this, "The keys could not be saved or activated. Check Windows Credential Manager and try again.", "Provider API Keys", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        finally { keysOpen = false; }
    }
}
