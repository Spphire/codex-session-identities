# Security

This sidecar manages sensitive model-provider credentials. It is intended for a single trusted Windows user on a trusted local machine, not as a remote multi-user administration service.

- The panel binds to loopback only and authenticates requests with a local access token. Writes also check Origin and JSON content type. The token is delivered in a URL fragment, removed from the URL, and retained in browser session storage.
- Panel service restarts reuse a valid saved panel token. Do not expose the local token file. If compromised, stop the panel, remove its `panel-access-<port>.json` file, restart it and reopen the panel to rotate authorization.
- API keys stay in Windows Credential Manager. Official credentials remain in the account's private home; imports are DPAPI-protected for the Windows user. System-login profiles refer to the global AuthManager rather than duplicating refresh tokens.
- A process running as the same Windows user can access local credentials. Loopback authentication and DPAPI are not isolation against malware or an administrator.
- Identity switching affects model-provider requests, not the Desktop's third-party connector accounts, existing external terminal jobs or service-provider permissions.

Do not put credentials, email lists, session databases, access descriptors, personal rollout histories or account screenshots in an issue or pull request. The public repository includes only synthetic test fixtures and summarized validation.

Report a suspected vulnerability through GitHub private vulnerability reporting when enabled. Do not publish exploit details containing credentials in a public issue. Revoke any accidentally exposed provider token immediately.
