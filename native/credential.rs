use std::io::Write;

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
}

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
    let check = args.get(2).is_some_and(|value| value == "--check");
    if args.len() == 3 && !check { return Err(()); }
    let target: Vec<u16> = format!("com.openai.codex.identity-switcher/{provider}").encode_utf16().chain(Some(0)).collect();
    let mut credential = std::ptr::null_mut();
    // Windows owns the returned allocation until CredFree; never log its content.
    unsafe {
        if CredReadW(target.as_ptr(), 1, 0, &mut credential) == 0 || credential.is_null() { return Err(()); }
        let item = &*credential;
        let result = if item.blob_size == 0 || item.blob.is_null() {
            Err(())
        } else if check {
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
