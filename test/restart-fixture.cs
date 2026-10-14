using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Web.Script.Serialization;
internal static class RestartFixture {
    static void Main() {
        string root=AppDomain.CurrentDomain.BaseDirectory;
        if(Path.GetFileNameWithoutExtension(Process.GetCurrentProcess().MainModule.FileName)=="TestDesktop") {
            Process backend=Process.Start(new ProcessStartInfo(Path.Combine(root,"TestBackend.exe")){UseShellExecute=false,CreateNoWindow=true});
            Process auxiliary=Process.Start(new ProcessStartInfo(Path.Combine(root,"TestAuxiliary.exe")){UseShellExecute=false,CreateNoWindow=true});
            File.WriteAllText(Path.Combine(root,"test-live.json"),new JavaScriptSerializer().Serialize(new {desktopPid=Process.GetCurrentProcess().Id,pid=backend.Id,auxiliaryPid=auxiliary.Id}));
        }
        Thread.Sleep(180000);
    }
}
