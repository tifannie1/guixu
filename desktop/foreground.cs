using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class GuixuForeground
{
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr GetShellWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr window, uint flags);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);

    private static uint Owner(IntPtr window)
    {
        if (window == IntPtr.Zero) return 0;
        uint pid;
        GetWindowThreadProcessId(window, out pid);
        return pid;
    }

    public static string Read(uint appPid)
    {
        var window = GetForegroundWindow();
        if (window == IntPtr.Zero) return "blocked";
        var pid = Owner(window);
        if (pid == appPid || Owner(GetAncestor(window, 3)) == appPid) return "guixu"; // GA_ROOTOWNER
        var shell = GetShellWindow();
        if (shell != IntPtr.Zero && window == shell) return "desktop";

        var buffer = new StringBuilder(120);
        GetClassName(window, buffer, buffer.Capacity);
        var windowClass = buffer.ToString();
        switch (windowClass)
        {
            case "Progman":
            case "WorkerW":
            case "SHELLDLL_DefView":
            case "SysListView32":
                return pid != 0 && pid == Owner(shell) ? "desktop" : "blocked";
            case "CabinetWClass":
            case "ExploreWClass":
                try
                {
                    using (var process = Process.GetProcessById((int)pid))
                        if (string.Equals(process.ProcessName, "explorer", StringComparison.OrdinalIgnoreCase))
                            return "explorer";
                }
                catch (ArgumentException) {}
                catch (InvalidOperationException) {}
                return "blocked";
            default:
                return "blocked";
        }
    }
}
