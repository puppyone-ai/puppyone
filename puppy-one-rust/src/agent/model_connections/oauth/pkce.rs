//! PKCE (RFC 7636, S256) and OAuth `state` values (`pkce.ts`).
use base64::Engine as _;
use sha2::Digest as _;

fn random_url_safe(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    getrandom::fill(&mut buffer).expect("system randomness");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buffer)
}

/// A code verifier and its S256 challenge.
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

impl Default for Pkce {
    fn default() -> Self {
        Self::new()
    }
}

impl Pkce {
    pub fn new() -> Self {
        let verifier = random_url_safe(32);
        let challenge = challenge(&verifier);
        Self {
            verifier,
            challenge,
        }
    }
}

/// `BASE64URL(SHA256(verifier))`.
pub fn challenge(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(sha2::Sha256::digest(verifier.as_bytes()))
}

/// An unguessable `state`.
pub fn state() -> String {
    random_url_safe(16)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 7636 appendix B.
    #[test]
    fn the_challenge_matches_the_rfc_vector() {
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn verifiers_and_states_are_fresh_and_url_safe() {
        let (a, b) = (Pkce::new(), Pkce::new());
        assert_ne!(a.verifier, b.verifier);
        assert_eq!(a.verifier.len(), 43);
        assert!(
            a.verifier
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        );
        assert_eq!(a.challenge, challenge(&a.verifier));
        assert_ne!(state(), state());
    }
}
