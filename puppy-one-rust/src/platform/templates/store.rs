//! `template-marketplace-service.mjs`: what a link names (the template's
//! details) and its verified files. A public template needs no account; one
//! the store will not hand out anonymously goes through the signed-in
//! account (`requestTemplateDownload`). A package comes only from the
//! store's own route for that template or from its managed bucket — a
//! descriptor cannot send the app anywhere else.
use super::{
    Plan,
    link::{self, TemplateRef, require_id},
    package::{self, BUNDLE_MAX},
};
use crate::platform::build_identity::Channel;
use serde_json::{Value, json};
use std::time::Duration;

/// `R2_HOST`: the store's managed package bucket.
const R2_HOST: &str = "13db2d16c6f86490873850f62fff5741.r2.cloudflarestorage.com";
const JSON_MAX: usize = 1024 * 1024;
const UNAVAILABLE: &str = "The template store is temporarily unavailable.";
pub const SIGNED_OUT: &str = "Sign in to Puppyone before creating a project from this template.";

/// What the card shows about a template.
#[derive(Clone, Debug, PartialEq)]
pub struct Detail {
    pub id: String,
    pub release_id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
    pub locale: String,
    pub file_count: Option<u64>,
    pub icon: Option<String>,
    /// Anything not delivered from GitHub needs an account.
    pub requires_sign_in: bool,
    pub share_url: String,
}

/// A response: its status and body, read up to a bound.
pub type Response = (u16, Vec<u8>);
pub trait Fetch: Send + Sync {
    fn get(&self, url: &str, timeout: Duration, max: usize) -> Result<Response, String>;
    fn post_json(
        &self,
        url: &str,
        body: &Value,
        timeout: Duration,
        max: usize,
    ) -> Result<Response, String>;
}
/// The network: no redirects, and a body larger than its bound is refused.
pub struct Http;
impl Http {
    fn send(
        request: impl FnOnce(&reqwest::Client) -> reqwest::RequestBuilder,
        timeout: Duration,
        max: usize,
    ) -> Result<Response, String> {
        use futures_util::StreamExt as _;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|_| UNAVAILABLE.to_owned())?;
        runtime.block_on(async {
            let client = crate::platform::proxy::system(reqwest::Client::builder())
                .redirect_policy(reqwest::redirect::Policy::none())
                .timeout(timeout)
                .build()
                .map_err(|_| UNAVAILABLE.to_owned())?;
            let response = request(&client)
                .send()
                .await
                .map_err(|_| UNAVAILABLE.to_owned())?;
            let status = response.status().as_u16();
            if response.content_length().is_some_and(|n| n > max as u64) {
                return Err("Template response exceeds its size limit.".to_owned());
            }
            let mut body = Vec::new();
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|_| UNAVAILABLE.to_owned())?;
                if body.len() + chunk.len() > max {
                    return Err("Template response exceeds its size limit.".to_owned());
                }
                body.extend_from_slice(&chunk);
            }
            Ok((status, body))
        })
    }
}
impl Fetch for Http {
    fn get(&self, url: &str, timeout: Duration, max: usize) -> Result<Response, String> {
        Self::send(|client| client.get(url), timeout, max)
    }
    fn post_json(
        &self,
        url: &str,
        body: &Value,
        timeout: Duration,
        max: usize,
    ) -> Result<Response, String> {
        Self::send(|client| client.post(url).json(body), timeout, max)
    }
}

/// Tests: the store every [`Store::current`] answers from.
#[cfg(any(test, feature = "test-support"))]
static TEST_FETCH: std::sync::Mutex<Option<std::sync::Arc<dyn Fetch>>> =
    std::sync::Mutex::new(None);
#[cfg(any(test, feature = "test-support"))]
impl Fetch for std::sync::Arc<dyn Fetch> {
    fn get(&self, url: &str, timeout: Duration, max: usize) -> Result<Response, String> {
        (**self).get(url, timeout, max)
    }
    fn post_json(
        &self,
        url: &str,
        body: &Value,
        timeout: Duration,
        max: usize,
    ) -> Result<Response, String> {
        (**self).post_json(url, body, timeout, max)
    }
}
/// Tests: a store with one public template, `files` in its package.
#[cfg(any(test, feature = "test-support"))]
pub fn install_test_store(files: &[(&str, &str)]) {
    use super::package::fixtures::{ID, RELEASE, package};
    struct Fixture(Vec<u8>, Value);
    impl Fetch for Fixture {
        fn get(&self, url: &str, _: Duration, _: usize) -> Result<Response, String> {
            if url.contains("/package") {
                return Ok((200, self.0.clone()));
            }
            Ok((
                200,
                serde_json::to_vec(
                    &json!({"id": ID, "release_id": RELEASE, "name": "Weekly: plan",
                    "description": "Plan a week.", "version": "1.0.0", "author": "Puppyone",
                    "locale": "en", "file_count": 1, "icon": null, "delivery": "github"}),
                )
                .unwrap(),
            ))
        }
        fn post_json(&self, _: &str, _: &Value, _: Duration, _: usize) -> Result<Response, String> {
            Ok((200, serde_json::to_vec(&self.1).unwrap()))
        }
    }
    let (bytes, descriptor) = package(files);
    *TEST_FETCH.lock().unwrap() = Some(std::sync::Arc::new(Fixture(bytes, descriptor)));
}
/// Captures: one template's details (`PUPPYONE_TEMPLATE_LAB`).
#[cfg(feature = "dev-capture")]
struct Lab;
#[cfg(feature = "dev-capture")]
impl Fetch for Lab {
    fn get(&self, url: &str, _: Duration, _: usize) -> Result<Response, String> {
        let id = url
            .split("/api/templates/")
            .nth(1)
            .and_then(|rest| rest.split('?').next())
            .unwrap_or_default();
        Ok((
            200,
            serde_json::to_vec(&json!({"id": id, "release_id": "11111111-2222-4333-8444-555555555555",
                "name": "Weekly planning kit", "description":
                "A week on one page: goals, a daily log and a Friday review, ready for you and your agent to fill in.",
                "version": "1.2.0", "author": "Puppyone", "locale": "en", "file_count": 6,
                "icon": "🗓️", "delivery": "github"}))
            .unwrap_or_default(),
        ))
    }
    fn post_json(&self, _: &str, _: &Value, _: Duration, _: usize) -> Result<Response, String> {
        Err(UNAVAILABLE.into())
    }
}
/// `readJson`: the body as JSON; a refusal carries the store's message.
fn read_json((status, body): Response) -> Result<Value, String> {
    let value: Value = serde_json::from_slice(&body).map_err(|_| UNAVAILABLE.to_owned())?;
    if !(200..300).contains(&status) {
        return Err(value["error"]["message"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| UNAVAILABLE.into()));
    }
    Ok(value)
}
fn cut(value: &Value, max: usize) -> String {
    let text = match value {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    };
    text.chars().take(max).collect()
}
/// The store's name for the app's language.
fn store_locale(locale: &str) -> &str {
    match locale {
        "zh-Hans" => "zh",
        "pt-BR" => "pt",
        other => other,
    }
}

pub struct Store {
    pub origin: String,
    pub channel: Channel,
    fetch: Box<dyn Fetch>,
}
impl Store {
    pub fn new(origin: String, channel: Channel, fetch: Box<dyn Fetch>) -> Self {
        Self {
            origin,
            channel,
            fetch,
        }
    }
    /// The store for this build, over the network.
    pub fn current() -> Self {
        #[cfg(any(test, feature = "test-support"))]
        if let Some(fetch) = TEST_FETCH.lock().unwrap().clone() {
            return Self::new(link::STORE_ORIGIN.into(), Channel::Dev, Box::new(fetch));
        }
        // Captures show a template without asking the store.
        #[cfg(feature = "dev-capture")]
        if std::env::var_os("PUPPYONE_TEMPLATE_LAB").is_some() {
            return Self::new(link::STORE_ORIGIN.into(), Channel::Dev, Box::new(Lab));
        }
        Self::new(
            link::store_origin(),
            crate::platform::build_identity::current().channel,
            Box::new(Http),
        )
    }
    pub fn parse(&self, value: &str) -> Result<TemplateRef, String> {
        link::parse(value, &self.origin, self.channel)
    }
    /// `resolveLink`: the template a link names, in the app's language.
    pub fn resolve(&self, value: &str, locale: &str) -> Result<Detail, String> {
        let template = self.parse(value)?;
        let mut url = url::Url::parse(&format!("{}/api/templates/{}", self.origin, template.id))
            .map_err(|_| UNAVAILABLE.to_owned())?;
        url.query_pairs_mut()
            .append_pair("locale", store_locale(locale));
        if let Some(release) = &template.release {
            url.query_pairs_mut().append_pair("release", release);
        }
        let detail = read_json(
            self.fetch
                .get(url.as_str(), Duration::from_secs(20), JSON_MAX)?,
        )?;
        let release = detail["release_id"].as_str().unwrap_or_default();
        if detail["id"] != template.id.as_str()
            || template.release.as_deref().is_some_and(|r| r != release)
            || !detail["name"].is_string()
            || !detail["description"].is_string()
        {
            return Err("Invalid template details.".into());
        }
        require_id(release)?;
        Ok(Detail {
            id: template.id.clone(),
            release_id: release.to_owned(),
            name: cut(&detail["name"], 200),
            description: cut(&detail["description"], 1000),
            version: cut(&detail["version"], 80),
            author: cut(&detail["author"], 200),
            locale: cut(&detail["locale"], 20),
            file_count: detail["file_count"].as_u64(),
            icon: detail["icon"]
                .as_str()
                .map(|i| i.chars().take(16).collect()),
            requires_sign_in: detail["delivery"] != "github",
            share_url: link::share_link(
                &TemplateRef {
                    id: template.id,
                    release: Some(release.to_owned()),
                },
                &self.origin,
            ),
        })
    }
    /// `requestPublicDownload`: `None` when the store wants an account.
    fn public_download(&self, id: &str, release: &str) -> Result<Option<Value>, String> {
        let response = self.fetch.post_json(
            &format!("{}/api/templates/{id}/download", self.origin),
            &json!({ "release_id": release }),
            Duration::from_secs(60),
            JSON_MAX,
        )?;
        if response.0 == 401 {
            return Ok(None);
        }
        read_json(response).map(Some)
    }
    /// `requireDownloadUrl`.
    fn download_url(&self, value: &str, id: &str) -> Result<url::Url, String> {
        let invalid = || "Invalid template download destination.".to_owned();
        let base = url::Url::parse(&self.origin).map_err(|_| invalid())?;
        let url = base.join(value).map_err(|_| invalid())?;
        let from_store = url.origin() == base.origin();
        let allowed = (from_store && url.path() == format!("/api/templates/{id}/package"))
            || (url.scheme() == "https"
                && url.host_str() == Some(R2_HOST)
                && url.port().is_none()
                && url.path().starts_with("/puppyone-template-packages/"));
        if !allowed || !url.username().is_empty() || url.password().is_some() {
            return Err(invalid());
        }
        Ok(url)
    }
    /// `resolveTemplate`: the release's verified files. `authorize` asks the
    /// store as the signed-in account when it will not answer anonymously.
    pub fn download(
        &self,
        id: &str,
        release: &str,
        authorize: impl FnOnce(&str) -> Result<Value, String>,
        now_ms: i64,
    ) -> Result<Plan, String> {
        require_id(id)?;
        require_id(release)?;
        let authorized = match self.public_download(id, release)? {
            Some(value) => value,
            None => authorize(&format!("{}/api/templates/{id}/download", self.origin))?,
        };
        let descriptor = package::descriptor(&authorized, id, release, now_ms)?;
        let url = self.download_url(&descriptor.download_url, id)?;
        let (status, bytes) = self.fetch.get(
            url.as_str(),
            Duration::from_secs(60),
            descriptor.bundle_bytes.min(BUNDLE_MAX),
        )?;
        if !(200..300).contains(&status) {
            return Err("Template download failed. Please retry.".into());
        }
        package::parse(&bytes, &descriptor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::templates::package::fixtures::{ID, RELEASE, package};
    use core::prelude::v1::test;
    use std::sync::Mutex;

    struct Fake {
        public: bool,
        bytes: Vec<u8>,
        descriptor: Value,
        asked: Mutex<Vec<String>>,
    }
    fn detail() -> Value {
        json!({"id": ID, "release_id": RELEASE, "name": "Weekly plan",
        "description": "Plan a week.", "version": "1.0.0", "author": "Puppyone",
        "locale": "zh", "file_count": 2, "icon": "🗓️", "delivery": "github"})
    }
    impl Fetch for std::sync::Arc<Fake> {
        fn get(&self, url: &str, _: Duration, max: usize) -> Result<Response, String> {
            self.asked.lock().unwrap().push(format!("GET {url}"));
            if url.contains("/package") {
                assert!(max >= self.bytes.len());
                return Ok((200, self.bytes.clone()));
            }
            // The card's details: the descriptor's fields stand in for any
            // the test changes.
            let mut detail = detail();
            if let Some(changes) = self.descriptor["detail"].as_object() {
                for (key, value) in changes {
                    detail[key] = value.clone();
                }
            }
            Ok((200, serde_json::to_vec(&detail).unwrap()))
        }
        fn post_json(
            &self,
            url: &str,
            body: &Value,
            _: Duration,
            _: usize,
        ) -> Result<Response, String> {
            self.asked
                .lock()
                .unwrap()
                .push(format!("POST {url} {body}"));
            if !self.public {
                return Ok((401, b"{}".to_vec()));
            }
            Ok((200, serde_json::to_vec(&self.descriptor).unwrap()))
        }
    }

    #[test]
    fn a_link_resolves_to_its_details_and_verified_files() {
        let (bytes, descriptor) = package(&[("Plan.md", "# Week"), ("a/b.md", "b")]);
        let fake = std::sync::Arc::new(Fake {
            public: true,
            bytes,
            descriptor: descriptor.clone(),
            asked: Default::default(),
        });
        let store = Store::new(
            link::STORE_ORIGIN.into(),
            Channel::Dev,
            Box::new(fake.clone()),
        );
        let detail = store
            .resolve(&format!("https://www.puppyone.ai/t/{ID}"), "zh-Hans")
            .unwrap();
        assert_eq!(detail.name, "Weekly plan");
        assert!(!detail.requires_sign_in);
        assert_eq!(
            detail.share_url,
            format!("https://www.puppyone.ai/t/{ID}?release={RELEASE}")
        );
        let plan = store.download(ID, RELEASE, |_| unreachable!(), 0).unwrap();
        assert_eq!(plan.initial_open.as_deref(), Some("Plan.md"));
        let asked = fake.asked.lock().unwrap().clone();
        assert_eq!(
            asked[0],
            format!("GET https://www.puppyone.ai/api/templates/{ID}?locale=zh")
        );
        assert!(asked[1].starts_with(&format!(
            "POST https://www.puppyone.ai/api/templates/{ID}/download"
        )));
        // A template the store keeps for accounts goes through the account.
        let private = std::sync::Arc::new(Fake {
            public: false,
            bytes: fake.bytes.clone(),
            descriptor: descriptor.clone(),
            asked: Default::default(),
        });
        let store = Store::new(link::STORE_ORIGIN.into(), Channel::Dev, Box::new(private));
        assert_eq!(
            store.download(ID, RELEASE, |_| Err(SIGNED_OUT.into()), 0),
            Err(SIGNED_OUT.into())
        );
        assert!(
            store
                .download(ID, RELEASE, |_| Ok(descriptor.clone()), 0)
                .is_ok()
        );
        // A descriptor cannot send the app elsewhere.
        let mut elsewhere = descriptor.clone();
        elsewhere["download_url"] = json!("https://evil.example/package.zip");
        assert!(
            store
                .download(ID, RELEASE, |_| Ok(elsewhere.clone()), 0)
                .unwrap_err()
                .contains("destination")
        );
    }

    fn fake(public: bool, descriptor: Value) -> std::sync::Arc<Fake> {
        let (bytes, _) = package(&[("Plan.md", "# Week"), ("a/b.md", "b")]);
        std::sync::Arc::new(Fake {
            public,
            bytes,
            descriptor,
            asked: Default::default(),
        })
    }
    fn store_of(fake: &std::sync::Arc<Fake>) -> Store {
        Store::new(
            link::STORE_ORIGIN.into(),
            Channel::Stable,
            Box::new(fake.clone()),
        )
    }
    fn asked(fake: &std::sync::Arc<Fake>) -> Vec<String> {
        fake.asked.lock().unwrap().clone()
    }
    const DOWNLOAD: &str =
        "https://www.puppyone.ai/api/templates/0d3b7a4e-1f2a-4b5c-8d9e-0123456789ab/download";

    /// `creates a public template with no account`: the store answers
    /// anonymously, the account is never asked, and the package comes from
    /// the store's own route for this template.
    #[test]
    fn a_public_template_needs_no_account_and_comes_from_its_own_route() {
        let (_, mut descriptor) = package(&[("Plan.md", "# Week"), ("a/b.md", "b")]);
        let route = format!("/api/templates/{ID}/package?release={RELEASE}");
        descriptor["download_url"] = json!(route);
        let fake = fake(true, descriptor);
        let plan = store_of(&fake)
            .download(ID, RELEASE, |_| unreachable!("no account"), 0)
            .unwrap();
        assert_eq!(plan.files.len(), 2);
        assert_eq!(
            asked(&fake),
            [
                format!("POST {DOWNLOAD} {}", json!({ "release_id": RELEASE })),
                format!("GET https://www.puppyone.ai{route}"),
            ]
        );
    }

    /// `rejects unauthenticated downloads and arbitrary download hosts`,
    /// `accepts the store's package address only for this template`: the
    /// store was asked once and nothing was downloaded.
    #[test]
    fn only_this_templates_package_address_is_downloaded() {
        let (_, descriptor) = package(&[("Plan.md", "# Week"), ("a/b.md", "b")]);
        let signed_out = fake(false, descriptor.clone());
        assert_eq!(
            store_of(&signed_out).download(ID, RELEASE, |_| Err(SIGNED_OUT.into()), 0),
            Err(SIGNED_OUT.into())
        );
        assert_eq!(asked(&signed_out).len(), 1);
        let route = format!("/api/templates/{ID}/package?release={RELEASE}");
        for destination in [
            "https://example.com/stolen".to_owned(),
            format!(
                "/api/templates/6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b/package?release={RELEASE}"
            ),
            "/api/template-packages?key=packages/x".into(),
            "/somewhere-else".into(),
            format!("https://user:secret@www.puppyone.ai{route}"),
            format!("http://www.puppyone.ai{route}"),
            format!("https://www.puppyone.ai.example.com{route}"),
        ] {
            let mut elsewhere = descriptor.clone();
            elsewhere["download_url"] = json!(destination);
            for public in [true, false] {
                let fake = fake(public, elsewhere.clone());
                let error = store_of(&fake)
                    .download(ID, RELEASE, |_| Ok(elsewhere.clone()), 0)
                    .unwrap_err();
                assert!(error.contains("destination"), "{destination}: {error}");
                assert_eq!(asked(&fake).len(), 1, "{destination}");
            }
        }
    }

    /// `electron.cloud-auth-service.test.mjs`: "rejects ... malformed requests
    /// without dispatch" — an id that is not a template's is refused before
    /// the store or the account is asked anything.
    #[test]
    fn a_malformed_template_id_is_refused_before_anything_is_sent() {
        let (_, descriptor) = package(&[("Plan.md", "# Week")]);
        let fake = fake(false, descriptor);
        for (id, release) in [("../../private", RELEASE), (ID, "../../private")] {
            assert!(
                store_of(&fake)
                    .download(id, release, |_| unreachable!("no account"), 0)
                    .is_err()
            );
        }
        assert!(asked(&fake).is_empty());
    }

    /// `describes a template for the card and says when it needs an
    /// account`, `pins the preview's selected release`.
    #[test]
    fn the_card_describes_the_pinned_release_and_whether_it_needs_an_account() {
        let link = format!("https://www.puppyone.ai/t/{ID}?release={RELEASE}");
        let github = fake(true, json!({"detail": {"file_count": 12, "icon": "🤝"}}));
        let detail = store_of(&github).resolve(&link, "zh-Hans").unwrap();
        assert_eq!(
            (
                detail.file_count,
                detail.icon.as_deref(),
                detail.requires_sign_in
            ),
            (Some(12), Some("🤝"), false)
        );
        assert_eq!(detail.release_id, RELEASE);
        assert_eq!(
            asked(&github),
            [format!(
                "GET https://www.puppyone.ai/api/templates/{ID}?locale=zh&release={RELEASE}"
            )]
        );
        let managed = fake(
            true,
            json!({"detail": {"delivery": "managed", "file_count": "12", "icon": null}}),
        );
        let detail = store_of(&managed).resolve(&link, "en").unwrap();
        assert_eq!(
            (detail.file_count, detail.icon, detail.requires_sign_in),
            (None, None, true)
        );
        // Another release than the one the link pins is not this template.
        let moved = fake(
            true,
            json!({"detail": {"release_id": "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b"}}),
        );
        assert!(store_of(&moved).resolve(&link, "en").is_err());
    }

    /// `downloads without forwarding the session token`: the network the
    /// store uses sends no credential and follows no redirect.
    #[test]
    fn store_requests_carry_no_credentials_and_follow_no_redirects() {
        use std::io::{BufRead as _, BufReader, Write as _};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for stream in listener.incoming().take(2) {
                let mut stream = stream.unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut head = Vec::new();
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" || line.is_empty() {
                        break;
                    }
                    head.push(line.trim_end().to_ascii_lowercase());
                }
                stream
                    .write_all(b"HTTP/1.1 302 Found\r\nLocation: /elsewhere\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")
                    .unwrap();
                requests.push(head);
            }
            requests
        });
        let post = Http
            .post_json(
                &format!("{origin}/api/templates/{ID}/download"),
                &json!({ "release_id": RELEASE }),
                Duration::from_secs(10),
                JSON_MAX,
            )
            .unwrap();
        let get = Http
            .get(
                &format!("{origin}/api/templates/{ID}/package"),
                Duration::from_secs(10),
                JSON_MAX,
            )
            .unwrap();
        assert_eq!((post.0, get.0), (302, 302));
        let requests = server.join().unwrap();
        assert!(requests[0][0].starts_with("post /api/templates/"));
        assert!(requests[1][0].starts_with("get /api/templates/"));
        for head in &requests {
            assert!(
                !head
                    .iter()
                    .any(|h| h.starts_with("authorization:") || h.starts_with("cookie:")),
                "{head:?}"
            );
            assert!(!head.iter().any(|h| h.contains("/elsewhere")));
        }
    }
}
