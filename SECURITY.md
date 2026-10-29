# Security policy

BlockHost is a development-stage project. Do not treat it as independently audited or production hardened.

- Do not expose the dashboard directly to the public internet.
- Treat Docker socket access as highly privileged.
- Use trusted networks, HTTPS, strong authentication and limited access.
- Do not commit credentials, server secrets or production world backups.
- Test restore and import operations before depending on them.

For sensitive security reports, contact the repository owner privately rather than posting exploit details to public issues.
