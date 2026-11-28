//! `cloud-publish-receipt.mjs`: Cloud's own record of one push attempt. A
//! first push whose response was lost asks Cloud what became of that exact
//! attempt instead of guessing from the ref alone: committed means the
//! attempt's commit created `main`; rejected means Cloud refused that attempt
//! for good. Anything else (missing, denied, pending, a mismatch, a redirect)
//! says nothing either way.
use super::{Code, PublishError, journal::Record};
use base64::Engine as _;
use serde_json::Value;
use std::time::Duration;

/// `refs/heads/main`, as Cloud names refs in a receipt.
const MAIN: &str = "refs/heads/main";
/// The receipt read is one bounded request.
pub const TIMEOUT: Duration = Duration::from_secs(10);

/// Reads a receipt: the response's status and JSON body, or `None` when no
/// response came (a redirect is refused, never followed).
pub trait Fetch: Send + Sync {
    fn get(&self, url: &url::Url, authorization: &str) -> Option<(u16, Value)>;
}

/// `receiptUrl`: the attempt's receipt under the journaled canonical remote,
/// which must be exactly `/git/<project>.git` over HTTPS (HTTP only on
/// loopback), without credentials, query or fragment.
pub fn receipt_url(record: &Record) -> Option<url::Url> {
    let id = uuid(&record.attempt.attempt_id)?;
    let project = record.project_id.as_deref()?;
    let mut url = url::Url::parse(record.canonical_remote_url.as_deref()?).ok()?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != format!("/git/{project}.git")
        || !(url.scheme() == "https" || (url.scheme() == "http" && loopback))
    {
        return None;
    }
    let path = format!("{}/operations/{id}", url.path());
    url.set_path(&path);
    Some(url)
}

/// `readInitialPushReceipt`: the attempt's commit when Cloud committed it
/// onto an absent `main`; an error when Cloud rejected the attempt; `None`
/// when the receipt says nothing.
pub fn initial_push_receipt(
    fetch: &dyn Fetch,
    record: &Record,
    secret: &str,
) -> Result<Option<String>, PublishError> {
    let Some(url) = receipt_url(record) else {
        return Ok(None);
    };
    let username = record.credential_username.as_deref().unwrap_or_default();
    let basic = base64::engine::general_purpose::STANDARD.encode(format!("{username}:{secret}"));
    let Some((status, body)) = fetch.get(&url, &format!("Basic {basic}")) else {
        return Ok(None);
    };
    read_receipt(record, status, &body)
}

/// What a receipt response says about the record's current attempt.
pub fn read_receipt(
    record: &Record,
    status: u16,
    body: &Value,
) -> Result<Option<String>, PublishError> {
    // Missing, denied, unavailable: never infer failure or success.
    if !(200..300).contains(&status) {
        return Ok(None);
    }
    let value = &body["data"];
    let Some(id) = uuid(&record.attempt.attempt_id) else {
        return Ok(None);
    };
    let project = record.project_id.as_deref();
    let result = &value["result"];
    let bound = value["project_id"].as_str() == project
        && value["request_key"].as_str() == Some(id.as_str())
        && result["project_id"].as_str() == project
        && result["status"] == value["status"];
    if !bound {
        return Ok(None);
    }
    let main = base64::engine::general_purpose::STANDARD.encode(MAIN);
    let refs = result["refs"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let [only] = refs else {
        return Ok(None);
    };
    if only["name_b64"].as_str() != Some(main.as_str())
        || only["new"]["kind"] != "oid"
        || only["new"]["oid"].as_str() != Some(record.attempt.commit_oid.as_str())
    {
        return Ok(None);
    }
    match value["status"].as_str() {
        Some("committed") if only["observed"]["kind"] == "absent" => {
            Ok(Some(record.attempt.commit_oid.clone()))
        }
        Some("rejected") => Err(PublishError::new(
            Code::PushFailed,
            "Cloud rejected this push attempt.",
            true,
        )),
        _ => Ok(None),
    }
}

/// A lowercase UUID, or `None`.
fn uuid(value: &str) -> Option<String> {
    let parsed = uuid::Uuid::parse_str(value).ok()?;
    (value.len() == 36).then(|| parsed.hyphenated().to_string())
}

/// The receipt over HTTPS, through the Cloud client: one `GET` that never
/// follows a redirect, is never cached and gives up after [`TIMEOUT`].
pub struct Http;
impl Fetch for Http {
    fn get(&self, url: &url::Url, authorization: &str) -> Option<(u16, Value)> {
        crate::cloud::auth::get_json(url, authorization, TIMEOUT)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use serde_json::json;
    use std::sync::Mutex;

    const ID: &str = "11111111-1111-4111-8111-111111111111";
    const REMOTE: &str = "https://api.puppyone.test/git/project-1.git";

    fn oid() -> String {
        "a".repeat(40)
    }
    fn record() -> Record {
        let mut record = super::super::initial_record(
            &super::super::Request {
                root: "/repo".into(),
                api_base_url: "https://api.puppyone.test/api/v1".into(),
                user_id: "user-1".into(),
                organization_id: "org-1".into(),
                project_name: "Untitled Project".into(),
                source_branch: "main".into(),
                operation_id: None,
                action: super::super::Action::Initialize,
            },
            "fingerprint",
            &oid(),
        );
        record.project_id = Some("project-1".into());
        record.canonical_remote_url = Some(REMOTE.into());
        record.credential_username = Some("x-puppyone-token".into());
        record.attempt.attempt_id = ID.into();
        record
    }
    fn envelope() -> Value {
        let main = base64::engine::general_purpose::STANDARD.encode("refs/heads/main");
        json!({"data": {
            "project_id": "project-1", "request_key": ID, "status": "committed",
            "result": {"project_id": "project-1", "status": "committed", "refs": [{
                "name_b64": main, "observed": {"kind": "absent"}, "new": {"kind": "oid", "oid": oid()},
            }]},
        }})
    }
    /// Answers every read with one response, recording what was asked.
    struct Answer(Option<(u16, Value)>, Mutex<Vec<(String, String)>>);
    impl Fetch for Answer {
        fn get(&self, url: &url::Url, authorization: &str) -> Option<(u16, Value)> {
            self.1
                .lock()
                .unwrap()
                .push((url.to_string(), authorization.to_owned()));
            self.0.clone()
        }
    }
    fn answer(status: u16, body: Value) -> Answer {
        Answer(Some((status, body)), Mutex::default())
    }
    const LOST: &str = "error: RPC failed; curl 28 Operation timed out\nfatal: the remote end hung up unexpectedly";

    /// `lost push response resolves by the bound receipt without ref
    /// discovery or backoff`: the attempt's receipt under the canonical
    /// remote, read once with the operation's credential, settles the push.
    #[test]
    fn a_lost_push_response_resolves_by_its_receipt_without_reading_the_ref() {
        let fetch = answer(200, envelope());
        let receipt = initial_push_receipt(&fetch, &record(), "pwg_secret");
        assert_eq!(receipt, Ok(Some(oid())));
        let asked = fetch.1.into_inner().unwrap();
        let basic = base64::engine::general_purpose::STANDARD.encode("x-puppyone-token:pwg_secret");
        assert_eq!(
            asked,
            [(
                format!("{REMOTE}/operations/{ID}"),
                format!("Basic {basic}")
            )]
        );
        let settled =
            crate::cloud::publication::git::settle_failed_push(LOST, &oid(), receipt, || {
                panic!("no ref discovery")
            });
        assert_eq!(settled, Ok(()));
    }

    /// `does not accept a {project, attempt, commit, ref, pending, absent,
    /// redirect} mismatch as success`.
    #[test]
    fn a_receipt_that_does_not_bind_this_attempt_says_nothing() {
        let other = base64::engine::general_purpose::STANDARD.encode("refs/heads/other");
        for fault in [
            "project", "attempt", "commit", "ref", "pending", "absent", "redirect",
        ] {
            let mut value = envelope();
            let data = &mut value["data"];
            match fault {
                "project" => data["project_id"] = json!("another-project"),
                "attempt" => data["request_key"] = json!("22222222-2222-4222-8222-222222222222"),
                "commit" => data["result"]["refs"][0]["new"]["oid"] = json!("b".repeat(40)),
                "ref" => data["result"]["refs"][0]["name_b64"] = json!(other),
                "pending" => {
                    data["status"] = json!("pending");
                    data["result"] = Value::Null;
                }
                _ => {}
            }
            let status = match fault {
                "absent" => 404,
                "redirect" => 302,
                _ => 200,
            };
            let fetch = answer(status, value);
            assert_eq!(
                initial_push_receipt(&fetch, &record(), "pwg_secret"),
                Ok(None),
                "{fault}"
            );
        }
        // No response at all says nothing either.
        let silent = Answer(None, Mutex::default());
        assert_eq!(initial_push_receipt(&silent, &record(), "s"), Ok(None));
        // Never a credential to a URL that is not the canonical remote's.
        let mut elsewhere = record();
        elsewhere.canonical_remote_url = Some("http://example.test/git/project-1.git".into());
        let fetch = answer(200, envelope());
        assert_eq!(initial_push_receipt(&fetch, &elsewhere, "s"), Ok(None));
        assert!(fetch.1.into_inner().unwrap().is_empty());
    }

    /// `a durable rejection terminates reconciliation`: Cloud's rejection of
    /// this attempt fails the push for good, read once.
    #[test]
    fn a_durable_rejection_fails_the_push() {
        let mut value = envelope();
        value["data"]["status"] = json!("rejected");
        value["data"]["result"]["status"] = json!("rejected");
        let fetch = answer(200, value);
        let receipt = initial_push_receipt(&fetch, &record(), "pwg_secret");
        assert_eq!(receipt.as_ref().map_err(|e| e.code), Err(Code::PushFailed));
        assert_eq!(fetch.1.into_inner().unwrap().len(), 1);
        let settled =
            crate::cloud::publication::git::settle_failed_push(LOST, &oid(), receipt, || None);
        let error = settled.unwrap_err();
        assert_eq!((error.code, error.retryable), (Code::PushFailed, true));
        // A limit refusal still says what to change.
        let limit = crate::cloud::publication::git::settle_failed_push(
            "remote: error: pack exceeds maximum allowed size",
            &oid(),
            Err(PublishError::new(Code::PushFailed, "rejected", true)),
            || None,
        );
        assert_eq!(limit.unwrap_err().code, Code::PushLimitExceeded);
    }

    /// The receipt over HTTP asks once, without cache, and never follows a
    /// redirect.
    #[test]
    fn the_http_receipt_is_uncached_and_never_follows_a_redirect() {
        use std::io::{BufRead, BufReader, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for _ in 0..1 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut head = String::new();
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" || line.is_empty() {
                        break;
                    }
                    head.push_str(&line);
                }
                requests.push(head);
                let body = "{}";
                write!(
                    stream,
                    "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{port}/elsewhere\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .unwrap();
            }
            requests
        });
        let url = url::Url::parse(&format!(
            "http://127.0.0.1:{port}/git/project-1.git/operations/{ID}"
        ))
        .unwrap();
        let answered = Http.get(&url, "Basic c2VjcmV0");
        assert_eq!(answered.map(|(status, _)| status), Some(302));
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 1, "the redirect is not followed");
        let head = requests[0].to_lowercase();
        assert!(head.starts_with(&format!("get /git/project-1.git/operations/{ID}")));
        assert!(head.contains("cache-control: no-store"), "{head}");
        assert!(head.contains("authorization: basic c2vjcmv0"), "{head}");
    }
}
