using System.Text.Json;

namespace BananaStudio;

internal static class WindowPlacement
{
    // Older files have no Maximized field and restore as a normal window.
    private sealed record Saved(int Version, int X, int Y, int Width, int Height, bool Maximized = false);
    internal static Rectangle Constrain(Rectangle bounds, IReadOnlyList<Rectangle> workAreas, Size minimum)
    {
        if (workAreas.Count == 0) return bounds;
        var screen = workAreas[0]; long best = 0;
        foreach (var candidate in workAreas)
        {
            var overlap = Rectangle.Intersect(candidate, bounds);
            var area = (long)Math.Max(0, overlap.Width) * Math.Max(0, overlap.Height);
            if (area > best) { best = area; screen = candidate; }
        }
        var width = Math.Min(screen.Width, Math.Max(minimum.Width, bounds.Width));
        var height = Math.Min(screen.Height, Math.Max(minimum.Height, bounds.Height));
        return new Rectangle(Math.Clamp(bounds.X, screen.Left, screen.Right - width),
            Math.Clamp(bounds.Y, screen.Top, screen.Bottom - height), width, height);
    }
    internal static (Rectangle Bounds, bool Maximized)? Load(string directory)
    {
        try
        {
            var file = Path.Combine(directory, "window-placement.json");
            if (new FileInfo(file).Length > 2048) return null;
            var value = JsonSerializer.Deserialize<Saved>(File.ReadAllText(file));
            if (value == null || value.Version != 1 || value.Width <= 0 || value.Height <= 0 ||
                new[] { value.X, value.Y, value.Width, value.Height }.Any(n => Math.Abs((long)n) > 100000)) return null;
            return (new Rectangle(value.X, value.Y, value.Width, value.Height), value.Maximized);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException) { return null; }
    }
    internal static void Save(string directory, Rectangle bounds, bool maximized = false)
    {
        if (bounds.Width <= 0 || bounds.Height <= 0) return;
        var temporary = Path.Combine(directory, ".window-placement-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            Directory.CreateDirectory(directory);
            File.WriteAllText(temporary, JsonSerializer.Serialize(new Saved(1, bounds.X, bounds.Y, bounds.Width, bounds.Height, maximized)));
            File.Move(temporary, Path.Combine(directory, "window-placement.json"), true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { /* Preferences cannot prevent saving work. */ }
        finally { try { File.Delete(temporary); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
    }
    internal static void Test()
    {
        var directory = Path.Combine(Path.GetTempPath(), "BananaStudio-window-test-" + Guid.NewGuid().ToString("N"));
        static void Require(bool value) { if (!value) throw new InvalidOperationException("Window placement test failed."); }
        try
        {
            Require(Load(directory) == null);
            var original = new Rectangle(20, 30, 900, 650);
            Save(directory, original); Require(Load(directory) == (original, false));
            Save(directory, original, true); Require(Load(directory) == (original, true));
            File.WriteAllText(Path.Combine(directory, "window-placement.json"), "{\"Version\":1,\"X\":20,\"Y\":30,\"Width\":900,\"Height\":650}");
            Require(Load(directory) == (original, false));
            var work = new Rectangle(0, 0, 1280, 720);
            var min = new Size(760, 560);
            Require(Constrain(original, new[] { work }, min) == original);
            Require(Constrain(new Rectangle(5000, 5000, 1400, 900), new[] { work }, min) == work);
            Require(Constrain(new Rectangle(-2000, -2000, 50, 50), new[] { work }, min) == new Rectangle(0, 0, 760, 560));
            Require(Constrain(original, new[] { new Rectangle(0, 0, 600, 400) }, min) == new Rectangle(0, 0, 600, 400));
            File.WriteAllText(Path.Combine(directory, "window-placement.json"), "not json"); Require(Load(directory) == null);
        }
        finally { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    }
}
