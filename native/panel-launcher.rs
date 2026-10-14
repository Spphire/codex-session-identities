#![windows_subsystem = "windows"]
use std::process::{Command,Stdio};
fn main(){
    let result=(||->std::io::Result<()>{
        let executable=std::env::current_exe()?;
        let directory=executable.parent().ok_or_else(||std::io::Error::other("Missing directory"))?;
        let mut command=Command::new(directory.join("node.exe"));
        command.arg(directory.join("open-panel.mjs")).args(std::env::args_os().skip(1)).stdout(Stdio::null()).stderr(Stdio::null());
        #[cfg(windows)] {use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
        let status=command.status()?;
        if !status.success(){return Err(std::io::Error::other("Panel launch failed"));}
        Ok(())
    })();
    if result.is_err(){std::process::exit(1);}
}
