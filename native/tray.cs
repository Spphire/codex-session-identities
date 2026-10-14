using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Collections.Generic;

internal static class Program {
    internal static readonly string Root = AppDomain.CurrentDomain.BaseDirectory;
    internal static JavaScriptSerializer Json { get { return new JavaScriptSerializer(); } }
    private static readonly object LogLock = new object();

    [STAThread]
    private static int Main(string[] args) {
        bool test = Array.IndexOf(args, "--self-test") >= 0;
        string hash;
        using (SHA256 sha = SHA256.Create()) {
            hash = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(Root.ToLowerInvariant()))).Replace("-", "");
        }
        string stopName = "Local\\CodexIdentityTrayStop_" + hash + (test ? "_test" : "");
        if (Array.IndexOf(args, "--stop") >= 0) {
            try { using (EventWaitHandle signal = EventWaitHandle.OpenExisting(stopName)) { signal.Set(); } }
            catch (WaitHandleCannotBeOpenedException) { }
            return 0;
        }
        using (Mutex mutex = new Mutex(false, "Local\\CodexIdentityTray_" + hash + (test ? "_test" : ""))) {
            bool acquired;
            try { acquired = mutex.WaitOne(0); } catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) return 0;
            try {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                using (EventWaitHandle stop = new EventWaitHandle(false, EventResetMode.AutoReset, stopName))
                using (TrayContext context = new TrayContext(test, stop)) {
                    if (test) {
                        context.VerifyMenu();
                        return 0;
                    }
                    Application.Run(context);
                }
                return 0;
            } catch (Exception error) {
                Status("failed", error.GetType().Name);
                return 1;
            } finally { mutex.ReleaseMutex(); }
        }
    }

    internal static void Status(string state, string detail) {
        lock (LogLock) {
            File.WriteAllText(Path.Combine(Root, "tray-status.json"), Json.Serialize(new {
                state = state, detail = detail, pid = Process.GetCurrentProcess().Id,
                sessionId = Process.GetCurrentProcess().SessionId,
                time = DateTime.UtcNow.ToString("o")
            }), new UTF8Encoding(false));
        }
    }

    internal static ProcessStartInfo StartInfo(string executable, string arguments) {
        ProcessStartInfo info = new ProcessStartInfo(Path.Combine(Root, executable), arguments);
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.WorkingDirectory = Root;
        Dictionary<string, object> config = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(Root, "runtime-config.json")));
        info.EnvironmentVariables["CODEX_HOME"] = Convert.ToString(config["codexHome"]);
        info.EnvironmentVariables["IDENTITY_PANEL_PORT"] = Convert.ToString(config["panelPort"]);
        return info;
    }
}

internal sealed class TrayContext : ApplicationContext {
    private readonly NotifyIcon icon;
    private readonly ContextMenuStrip menu;
    private readonly ToolStripMenuItem open;
    private readonly ToolStripMenuItem quit;
    private readonly bool test;
    private Icon ownedIcon;
    private int openCalls;
    private volatile bool closed;
    private int opening;
    private volatile bool showOpenError;
    private readonly System.Windows.Forms.Timer stopTimer;

    internal TrayContext(bool selfTest, EventWaitHandle stop) {
        test = selfTest;
        menu = new ContextMenuStrip();
        open = new ToolStripMenuItem("打开身份面板");
        quit = new ToolStripMenuItem("退出托盘");
        open.Click += delegate { OpenPanel(); };
        quit.Click += delegate { ExitThread(); };
        menu.Items.Add(open);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(quit);
        icon = new NotifyIcon();
        icon.Text = "Codex 会话身份";
        icon.Icon = SystemIcons.Application;
        try {
            Dictionary<string, object> config = Program.Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(Program.Root, "runtime-config.json")));
            ownedIcon = Icon.ExtractAssociatedIcon(Convert.ToString(config["desktopExe"]));
            if (ownedIcon != null) icon.Icon = ownedIcon;
        } catch { }
        icon.ContextMenuStrip = menu;
        icon.MouseClick += delegate(object sender, MouseEventArgs e) { if (e.Button == MouseButtons.Left) OpenPanel(); };
        icon.Visible = true;
        stopTimer = new System.Windows.Forms.Timer();
        stopTimer.Interval = 250;
        stopTimer.Tick += delegate {
            if (stop.WaitOne(0)) ExitThread();
            if (showOpenError && !closed) {
                showOpenError = false;
                icon.ShowBalloonTip(4000, "Codex 会话身份", "无法启动默认浏览器，请查看 tray-status.json。", ToolTipIcon.Error);
            }
        };
        if (!test) stopTimer.Start();
        if (!test) {
            Program.Status("visible", "service_check_pending");
            ThreadPool.QueueUserWorkItem(delegate {
                try {
                    using (Process process = Process.Start(Program.StartInfo("node.exe", "\"" + Path.Combine(Program.Root, "open-panel.mjs") + "\" --check"))) {
                        if (!process.WaitForExit(15000)) { process.Kill(); throw new TimeoutException(); }
                        if (process.ExitCode != 0) throw new IOException("Panel unavailable");
                    }
                    if (!closed) Program.Status("ready", "panel_service_ready");
                } catch (Exception error) { if (!closed) Program.Status("service_error", error.GetType().Name); }
            });
        }
    }

    private void OpenPanel() {
        if (test) { openCalls++; return; }
        if (Interlocked.Exchange(ref opening, 1) != 0) return;
        Program.Status("opening", "panel_open_requested");
        ThreadPool.QueueUserWorkItem(delegate {
            try {
                using (Process process = Process.Start(Program.StartInfo("identity-panel.exe", ""))) {
                    if (!process.WaitForExit(20000)) { process.Kill(); throw new TimeoutException(); }
                    if (process.ExitCode != 0) throw new IOException("Panel launch failed");
                }
                if (!closed) Program.Status("ready", "browser_activation_succeeded");
            } catch (Exception error) {
                if (!closed) Program.Status("open_failed", error.GetType().Name);
                showOpenError = true;
            } finally { Interlocked.Exchange(ref opening, 0); }
        });
    }

    internal void VerifyMenu() {
        bool visible = icon.Visible;
        open.PerformClick();
        quit.PerformClick();
        if (!visible || openCalls != 1 || !closed || icon.Visible) throw new InvalidOperationException("Tray menu verification failed");
        File.WriteAllText(Path.Combine(Program.Root, "tray-self-test.json"), Program.Json.Serialize(new {
            passed = true, iconCreated = visible, openMenuInvoked = openCalls == 1, exitHidesIcon = !icon.Visible,
            note = "WinForms event wiring and icon lifecycle verified; this is not a screenshot of the Windows notification area."
        }), new UTF8Encoding(false));
    }

    protected override void ExitThreadCore() {
        closed = true;
        icon.Visible = false;
        if (!test) Program.Status("stopped", "tray_exit_requested");
        base.ExitThreadCore();
    }

    protected override void Dispose(bool disposing) {
        closed = true;
        if (disposing) { stopTimer.Dispose(); icon.Visible = false; icon.Dispose(); menu.Dispose(); if (ownedIcon != null) ownedIcon.Dispose(); }
        base.Dispose(disposing);
    }
}
