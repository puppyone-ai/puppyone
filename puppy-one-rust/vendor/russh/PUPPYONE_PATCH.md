# russh 0.65.1, patched for PuppyOne

This is the crates.io release of `russh` 0.65.1 with one change, used through
`[patch.crates-io]` in `puppy-one-rust/Cargo.toml`. Nothing else differs from
the published source.

## The patch: a certificate's signature named by its certificate type

The PuppyOne TypeScript host client (`electron/main/hosts/ssh/openssh.mjs`
`certificateKey`, over `ssh2`) gives its certificate key the certificate's
type, and `ssh2` names the signature with the key's type: the signature blob
says `ssh-ed25519-cert-v01@openssh.com` while its bytes are an ordinary
Ed25519 signature by the certified key. The TypeScript host accepts that;
russh rejects it ("signature algorithm does not match the requested one"),
so a TypeScript App could not open a folder a Rust host shares.

`src/server/encrypted.rs`: for a certificate request only, a signature named
by exactly the requested certificate algorithm is read as the algorithm that
type maps to (`Algorithm::new_certificate_ext`). The signature is then
verified against the certificate's key as before, and the certificate itself
is checked by the host (`src/workspace/hosts/ssh.rs::verify_certificate`).
Any other mismatch is still refused.

Verified by `hosts::acceptance::a_folder_this_host_shares_opens_from_typescript`
against the qubits deployment.
