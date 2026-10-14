use std::process::Command;

fn main() {
    if let Err(error) = run() {
        eprintln!("Identity bridge launch failed: {error}");
        std::process::exit(1);
    }
}

fn run() -> std::io::Result<()> {
    let executable = std::env::current_exe()?;
    let directory = executable.parent().ok_or_else(|| std::io::Error::other("missing install directory"))?;
    let mut command = Command::new(directory.join("node.exe"));
    command.arg(directory.join("runtime-bridge.cjs"));
    command.args(std::env::args_os().skip(1));
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let status = command.status()?;
    std::process::exit(status.code().unwrap_or(1));
}
