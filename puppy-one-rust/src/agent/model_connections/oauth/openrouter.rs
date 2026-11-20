//! OpenRouter sign-in (`openrouter.ts`): browser PKCE on an ephemeral
//! loopback port; the code is exchanged for a permanent, user-controlled API
//! key, stored as one.
use super::loopback::Callback;
use super::{Cancel, Progress, client, pkce};
use crate::agent::model_connections::credentials::Credential;
use std::sync::Arc;

pub struct Endpoints {
    pub authorize: String,
    pub keys: String,
}
impl Default for Endpoints {
    fn default() -> Self {
        Self {
            authorize: "https://openrouter.ai/auth".into(),
            keys: "https://openrouter.ai/api/v1/auth/keys".into(),
        }
    }
}

pub fn authorize_url(endpoints: &Endpoints, callback: &str, challenge: &str) -> String {
    let mut url = url::Url::parse(&endpoints.authorize).expect("authorize URL");
    url.query_pairs_mut()
        .append_pair("callback_url", callback)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256");
    url.into()
}

pub async fn login(
    endpoints: &Endpoints,
    progress: Arc<dyn Fn(Progress) + Send + Sync>,
    cancel: &Cancel,
) -> Result<Credential, String> {
    let callback = Callback::bind(0)?;
    // An unguessable path stands in for `state`, which OpenRouter does not echo.
    let path = format!("/oauth/callback/{}", uuid::Uuid::new_v4());
    let callback_url = format!("http://127.0.0.1:{}{path}", callback.port);
    let pkce = pkce::Pkce::new();
    progress(Progress::OpenBrowser {
        url: authorize_url(endpoints, &callback_url, &pkce.challenge),
    });
    let authorization = callback
        .wait(path, None, cancel.clone(), super::LOGIN_TIMEOUT)
        .await?;
    progress(Progress::Exchanging);
    let response = client()?
        .post(&endpoints.keys)
        .header("accept", "application/json")
        .json(&serde_json::json!({
            "code": authorization.code,
            "code_verifier": pkce.verifier,
            "code_challenge_method": "S256",
        }))
        .send()
        .await
        .map_err(|_| "OAUTH_UNREACHABLE".to_owned())?;
    if !response.status().is_success() {
        return Err("OAUTH_EXCHANGE_FAILED".into());
    }
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "OAUTH_INVALID_RESPONSE".to_owned())?;
    let key = body["key"]
        .as_str()
        .filter(|k| !k.is_empty())
        .ok_or("OAUTH_INVALID_RESPONSE")?;
    Ok(Credential::ApiKey {
        key: key.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sign_in_returns_the_issued_key() {
        let (base, server) =
            super::super::test_server::serve(vec![("200 OK", r#"{"key":"sk-or-issued"}"#)]);
        let endpoints = Endpoints {
            authorize: "https://openrouter.example.test/auth".into(),
            keys: format!("{base}/keys"),
        };
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        let progress: Arc<dyn Fn(Progress) + Send + Sync> = Arc::new(move |p| {
            if let Progress::OpenBrowser { url } = p {
                let _ = tx.send(url);
            }
        });
        let browser = std::thread::spawn(move || {
            let url = url::Url::parse(&rx.recv().unwrap()).unwrap();
            let pairs: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
            let callback = url::Url::parse(&pairs["callback_url"]).unwrap();
            assert_eq!(callback.host_str(), Some("127.0.0.1"));
            use std::io::{Read, Write};
            let mut stream =
                std::net::TcpStream::connect(("127.0.0.1", callback.port().unwrap())).unwrap();
            write!(stream, "GET {}?code=c1 HTTP/1.1\r\n\r\n", callback.path()).unwrap();
            let mut page = String::new();
            let _ = stream.read_to_string(&mut page);
        });
        let credential = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(login(&endpoints, progress, &Cancel::default()))
            .unwrap();
        browser.join().unwrap();
        assert_eq!(credential.bearer(), "sk-or-issued");
        let request = &server.join().unwrap()[0];
        let body: serde_json::Value = serde_json::from_str(&request.body).unwrap();
        assert_eq!(body["code"], "c1");
        assert_eq!(body["code_challenge_method"], "S256");
        assert_eq!(
            super::super::pkce::challenge(body["code_verifier"].as_str().unwrap()).len(),
            43
        );
    }
}
