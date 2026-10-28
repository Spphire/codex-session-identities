use std::io::{Read, Write};

#[repr(C)]
struct Credential {
    flags: u32,
    kind: u32,
    target: *mut u16,
    comment: *mut u16,
    last_written: [u32; 2],
    blob_size: u32,
    blob: *mut u8,
    persist: u32,
    attribute_count: u32,
    attributes: *mut std::ffi::c_void,
    alias: *mut u16,
    username: *mut u16,
}

#[link(name = "advapi32")]
unsafe extern "system" {
    fn CredReadW(target: *const u16, kind: u32, flags: u32, result: *mut *mut Credential) -> i32;
    fn CredFree(buffer: *mut std::ffi::c_void);
    fn CredWriteW(credential: *const Credential, flags: u32) -> i32;
    fn CredDeleteW(target: *const u16, kind: u32, flags: u32) -> i32;
}
#[link(name = "kernel32")]
unsafe extern "system" { fn GetLastError() -> u32; }

fn main() {
    if run().is_err() {
        eprintln!("Registered API credential is unavailable for this Windows user");
        std::process::exit(1);
    }
}

fn run() -> Result<(), ()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 2 || args[0] != "--provider-id" || args.len() > 3 {
        return Err(());
    }
    let provider = &args[1];
    if provider.is_empty() || provider.len() > 160 || !provider.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-') {
        return Err(());
    }
    let mode = args.get(2).map(String::as_str).unwrap_or("--read");
    if !["--read", "--check", "--store", "--delete"].contains(&mode) { return Err(()); }
    if ["--store", "--delete"].contains(&mode) && !provider.starts_with("identity_api_") { return Err(()); }
    let mut target: Vec<u16> = format!("com.openai.codex.identity-switcher/{provider}").encode_utf16().chain(Some(0)).collect();
    let mut credential = std::ptr::null_mut();
    // Windows owns the returned allocation until CredFree; never log its content.
    unsafe {
        if mode == "--delete" {
            return if CredDeleteW(target.as_ptr(), 1, 0) != 0 || GetLastError() == 1168 { Ok(()) } else { Err(()) };
        }
        if mode == "--store" {
            // Creation only: adding a new profile must not overwrite another key.
            if CredReadW(target.as_ptr(), 1, 0, &mut credential) != 0 {
                if !credential.is_null() { CredFree(credential.cast()); }
                return Err(());
            }
            if GetLastError() != 1168 { return Err(()); }
            let mut secret = Vec::new();
            std::io::stdin().take(2561).read_to_end(&mut secret).map_err(|_| ())?;
            if secret.is_empty() || secret.len() > 2560 || secret.iter().any(|b| b.is_ascii_whitespace() || *b == 0) || std::str::from_utf8(&secret).is_err() { return Err(()); }
            let mut user: Vec<u16> = "codex-session-identities".encode_utf16().chain(Some(0)).collect();
            let item = Credential { flags: 0, kind: 1, target: target.as_mut_ptr(), comment: std::ptr::null_mut(), last_written: [0; 2], blob_size: secret.len() as u32, blob: secret.as_mut_ptr(), persist: 2, attribute_count: 0, attributes: std::ptr::null_mut(), alias: std::ptr::null_mut(), username: user.as_mut_ptr() };
            let stored = CredWriteW(&item, 0) != 0;
            secret.fill(0);
            return if stored { Ok(()) } else { Err(()) };
        }
        if CredReadW(target.as_ptr(), 1, 0, &mut credential) == 0 || credential.is_null() { return Err(()); }
        let item = &*credential;
        let result = if item.blob_size == 0 || item.blob.is_null() {
            Err(())
        } else if mode == "--check" {
            Ok(())
        } else {
            let bytes = std::slice::from_raw_parts(item.blob, item.blob_size as usize);
            let mut stdout = std::io::stdout().lock();
            stdout.write_all(bytes).and_then(|_| stdout.flush()).map_err(|_| ())
        };
        CredFree(credential.cast());
        result
    }
}
