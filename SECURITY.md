# Security

This sidecar manages sensitive model-provider credentials. It is intended for a single trusted Windows user on a trusted local machine, not as a remote multi-user administration service.

- The panel binds to loopback only and authenticates requests with a local access token. Writes also check Origin and JSON content type. The token is delivered in a URL fragment, removed from the URL, and retained in browser session storage.
- Panel service restarts reuse a valid saved panel token. Do not expose the local token file. If compromised, stop the panel, remove its `panel-access-<port>.json` file, restart it and reopen the panel to rotate authorization.
- API keys stay in Windows Credential Manager. Official credentials remain in the account's private home; imports are DPAPI-protected for the Windows user. System-login profiles refer to the global AuthManager rather than duplicating refresh tokens.
- A process running as the same Windows user can access local credentials. Loopback authentication and DPAPI are not isolation against malware or an administrator.
- Identity switching affects model-provider requests, not the Desktop's third-party connector accounts, existing external terminal jobs or service-provider permissions.
- Official quota reads use each verified profile's access token and account header, with account/user checks before and after the response. The HTTPS destination is fixed to `chatgpt.com/backend-api/wham/usage`; redirects are not followed. Only normalized allowances, reset times and Credits status reach the authenticated browser. Refresh tokens and login files are never modified by quota queries.
- Re-login uses an isolated original-CLI device-code process. The returned account/user claims must match the existing private profile before its credential file is atomically replaced; a system login profile cannot be overwritten by this panel action.
- Forked side-chat bindings carry their parent thread reference. A parent identity switch updates descendants and unloads idle child runtimes before they can send another request; active descendants make the parent switch wait.
- The default shortcut requests Administrator access using Windows UAC and the same Windows user SID; a separate Standard shortcut is retained. It verifies the backend process token and preserves account bindings. An elevated backend increases the authority of its unsandboxed child processes.
- The authenticated panel defaults to YOLO (`danger-full-access`, `never`); switching off selects workspace-write with on-request approvals. The shared, versioned policy applies to subsequent local bridged requests across identities and side chats. It does not cancel active turns or child processes, change Windows tokens, bypass managed requirements, change native computer-use app permissions, or disable mandatory tool confirmations. Native per-chat permission choices are overridden by this global setting while management is enabled.
- Appshots are captured by the original Desktop, subject to its native availability and organization policy. The identity panel does not receive screenshot data; image/text requests remain on Desktop's transport.

Do not put credentials, email lists, session databases, access descriptors, personal rollout histories or account screenshots in an issue or pull request. The public repository includes only synthetic test fixtures and summarized validation.

Report a suspected vulnerability through GitHub private vulnerability reporting when enabled. Do not publish exploit details containing credentials in a public issue. Revoke any accidentally exposed provider token immediately.
