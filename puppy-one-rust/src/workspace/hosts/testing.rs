//! The Cloud's access side in memory, for the window's tests: a catalog
//! of one computer with one folder, certificates from its own authority,
//! and tunnels that end at a real host SSH server for a local directory.
use super::lines::HostError;
use super::protocol::Capability;
use super::remote::{Cloud, Socket, bytes, runtime};
use super::ssh::{new_key, public_line};
use super::{
    files::{Folders, Grant},
    ssh::{Authorities, HostIdentity, HostSsh},
};
use futures_util::SinkExt;
use russh::keys::{
    PrivateKey, PublicKey,
    ssh_key::{self, certificate::CertType},
};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tokio_tungstenite::tungstenite::Message;

pub const FOLDER: &str = "6f2c9f43-3c1b-4a8e-9c4e-1a2b3c4d5e6f";
pub const DEVICE: &str = "0d9b7f61-1111-4c2a-8b2e-7a6b5c4d3e2f";
pub const ACCOUNT: &str = "1e8a6c52-2222-4b3a-9c3f-6b5a4c3d2e1f";

pub struct Shared(std::path::PathBuf);
impl Folders for Shared {
    fn resolve(&self, folder: &str) -> Option<Grant> {
        (folder == FOLDER).then(|| Grant {
            root: self.0.clone(),
            active: true,
            capabilities: vec![
                Capability::Read,
                Capability::Write,
                Capability::Shell,
                Capability::Git,
                Capability::Agent,
            ],
        })
    }
}
/// Runs in the folder as this user, without a sandbox: the bridge alone.
pub struct Plain;
impl super::exec::Execution for Plain {
    fn prepare(
        &self,
        _: &std::path::Path,
        run: &super::exec::Run,
    ) -> Result<super::exec::Prepared, &'static str> {
        let args = match run {
            super::exec::Run::Command(command) => vec!["-c".into(), command.clone()],
            super::exec::Run::Shell => Vec::new(),
            super::exec::Run::Agent(_) => return Err("launcher_unavailable"),
        };
        Ok(super::exec::Prepared {
            program: "/bin/sh".into(),
            args,
            env: vec![("PATH".into(), "/usr/bin:/bin".into())],
        })
    }
}
pub struct Ca(PublicKey);
impl Authorities for Ca {
    fn keys(&self, _: bool) -> Vec<PublicKey> {
        vec![self.0.clone()]
    }
}
/// The Cloud in memory: a catalog, certificates from its authority, and
/// tunnels that end at the host's SSH server.
pub struct Fake {
    ca: PrivateKey,
    host: HostSsh,
    host_key: String,
    pub online: Mutex<bool>,
    pub refuse: Mutex<Option<&'static str>>,
    pub tunnels: Mutex<Vec<String>>,
    pub revoked: Mutex<Vec<String>>,
}
impl Cloud for Fake {
    fn catalog(&self) -> Result<Value, HostError> {
        Ok(json!({"devices": [{
            "id": DEVICE, "name": "Studio Mac", "platform": "darwin", "state": "active",
            "revision": 1, "online": *self.online.lock().unwrap(), "last_seen_at": null,
            "folders": [{"id": FOLDER, "name": "notes", "state": "active", "revision": 3,
                "capabilities": ["folder.read", "folder.write", "folder.shell", "folder.git",
                    "folder.someday"]}]
        }, {"id": "not-a-uuid", "name": "x", "folders": []}]}))
    }
    fn revoke(&self, device: &str) -> Result<Value, HostError> {
        self.revoked.lock().unwrap().push(device.to_owned());
        Ok(json!({ "revoked": true }))
    }
    fn certificate(&self, device: &str, public_key: &str) -> Result<Value, HostError> {
        assert_eq!(device, DEVICE);
        let key = PublicKey::from_openssh(public_key).unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let mut builder = ssh_key::certificate::Builder::new(
            [9u8; 16],
            key.key_data().clone(),
            now - 60,
            now + 300,
        )
        .unwrap();
        builder.cert_type(CertType::User).unwrap();
        builder.key_id(format!("user:{ACCOUNT}")).unwrap();
        builder.valid_principal(DEVICE).unwrap();
        let certificate = builder.sign(&self.ca).unwrap().to_openssh().unwrap();
        Ok(json!({"certificate": certificate, "host_key": self.host_key, "gateway_url": ""}))
    }
    fn origin(&self) -> url::Url {
        url::Url::parse("https://api.puppyone.ai").unwrap()
    }
    fn tunnel(&self, url: &url::Url) -> Result<Box<dyn Socket>, HostError> {
        self.tunnels.lock().unwrap().push(url.to_string());
        let refuse = *self.refuse.lock().unwrap();
        let host = self.host.clone();
        let (near, far) = tokio::io::duplex(256 * 1024);
        let client = runtime().block_on(async move {
            tokio::spawn(async move {
                let mut server = tokio_tungstenite::accept_async(far).await.unwrap();
                let frame = match refuse {
                    Some(code) => json!({"type": "error", "code": code}),
                    None => json!({"type": "ready"}),
                };
                server
                    .send(Message::Text(frame.to_string().into()))
                    .await
                    .unwrap();
                if refuse.is_some() {
                    return;
                }
                host.serve(bytes(Box::new(server)), FOLDER.into()).await;
            });
            tokio_tungstenite::client_async("ws://localhost/", near)
                .await
                .unwrap()
                .0
        });
        Ok(Box::new(client))
    }
}

pub fn fake(root: std::path::PathBuf) -> Arc<Fake> {
    let (ca, host_key) = (new_key(), new_key());
    let mut host = HostSsh::new(
        Arc::new(HostIdentity {
            account: ACCOUNT.into(),
            device: DEVICE.into(),
            key: host_key.clone(),
        }),
        Arc::new(Ca(ca.public_key().clone())),
        Arc::new(Shared(root)),
        Some(Arc::new(Plain)),
    );
    host.git = Some(Arc::new(super::git::GitService::new(Arc::new(
        super::git::PlainGit,
    ))));
    Arc::new(Fake {
        host,
        ca,
        host_key: public_line(&host_key),
        online: Mutex::new(true),
        refuse: Mutex::new(None),
        tunnels: Mutex::default(),
        revoked: Mutex::default(),
    })
}
