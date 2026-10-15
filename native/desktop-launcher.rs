#![windows_subsystem = "windows"]
use std::fs::OpenOptions;
use std::io::Write;
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

#[link(name = "user32")]
unsafe extern "system" {
    fn MessageBoxW(owner: *mut std::ffi::c_void, text: *const u16, caption: *const u16, style: u32) -> i32;
}

fn main() {
    if let Err(error) = run() {
        let text: Vec<u16> = format!("Codex identity launcher failed: {error}\nSee desktop-launcher.log and desktop-launcher-output.log in the installation directory.").encode_utf16().chain(Some(0)).collect();
        let title: Vec<u16> = "Codex Session Identities".encode_utf16().chain(Some(0)).collect();
        unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), 0x50010); }
        std::process::exit(1);
    }
}

fn run() -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    let executable = std::env::current_exe()?;
    let directory = executable.parent().ok_or_else(|| std::io::Error::other("missing install directory"))?;
    let mut log = OpenOptions::new().create(true).append(true).open(directory.join("desktop-launcher.log"))?;
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    writeln!(log, "{timestamp} native_launcher_started pid={}", std::process::id())?;
    let output = OpenOptions::new().create(true).append(true).open(directory.join("desktop-launcher-output.log"))?;
    let windows = std::env::var_os("SystemRoot").ok_or_else(|| std::io::Error::other("missing SystemRoot"))?;
    let powershell = std::path::PathBuf::from(windows).join("System32/WindowsPowerShell/v1.0");
    let mut command = Command::new(powershell.join("powershell.exe"));
    command.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(directory.join("Launch-Codex.ps1"))
        .current_dir(directory)
        .env("PSModulePath", powershell.join("Modules"))
        .stdin(Stdio::null()).stdout(output.try_clone()?).stderr(output)
        .creation_flags(0x08000000);
    if std::env::args_os().skip(1).any(|arg| arg == "--check") { command.arg("-CheckOnly"); }
    if std::env::args_os().skip(1).any(|arg| arg == "--restart") { command.arg("-Restart"); }
    if std::env::args_os().skip(1).any(|arg| arg == "--admin") { command.arg("-Admin"); }
    let status = command.status()?;
    writeln!(log, "powershell_exited code={:?}", status.code())?;
    if !status.success() { return Err(std::io::Error::other(format!("PowerShell exited with {:?}", status.code()))); }
    Ok(())
}
