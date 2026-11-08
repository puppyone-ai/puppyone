//! SSH that ends on the host (`transport.ssh`, `host-ssh-server.mjs`,
//! `host-ssh-client.mjs`). The Cloud admits a tunnel for one folder and
//! relays its bytes; everything else is decided at the two ends.
//!
//! The host: its identity is this device's registered Ed25519 key; a
//! client logs in only with an Ed25519 user certificate from the Cloud's SSH
//! authority, for this device (principal), for this computer's account (key
//! id `user:<account>`), valid now, with no critical options. The SSH user
//! is the folder, which must be the folder the tunnel was admitted for and
//! still shared here. It serves the `puppyone-files` subsystem, and shell,
//! pty and exec when an execution service is present; no forwarding of any
//! kind, no X11, no agent, no SFTP. Every request reads this computer's
//! consent again.
//!
//! The access side: a fresh Ed25519 key per connection, the certificate the
//! Cloud issued for it, and only the host key the Cloud registered for the
//! device — never trust on first use.
use super::{
    files::{FileService, Folders},
    lines::{self, FilesClient, HostError},
    protocol::{AGENT_COMMAND, Capability, FILES_SUBSYSTEM},
};
use russh::{
    Channel, ChannelId,
    keys::{
        Certificate, PrivateKey, PublicKey,
        ssh_key::{self, certificate::CertType, private::Ed25519Keypair},
    },
    server::{self, Auth, Msg, Session},
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::io::{AsyncRead, AsyncWrite};

/// At most this many SSH connections at once on a host.
const MAX_CONNECTIONS: usize = 16;
/// Environment a client may set.
fn safe_env(name: &str) -> bool {
    matches!(name, "TERM" | "LANG" | "COLORTERM")
        || name
            .strip_prefix("LC_")
            .is_some_and(|rest| !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_uppercase()))
}

/// A fresh Ed25519 key.
pub fn new_key() -> PrivateKey {
    let mut seed = [0u8; 32];
    getrandom::fill(&mut seed).expect("system randomness");
    PrivateKey::from(Ed25519Keypair::from_seed(&seed))
}
/// The key's public half as an OpenSSH line (`ssh-ed25519 AAAA…`).
pub fn public_line(key: &PrivateKey) -> String {
    key.public_key().to_openssh().unwrap_or_default()
}

/// `verifyUserCertificate`: a certificate the host accepts for `device`
/// and `account` at `now` (Unix seconds).
pub fn verify_certificate(
    certificate: &Certificate,
    authorities: &[PublicKey],
    device: &str,
    account: &str,
    now: u64,
) -> Result<(), &'static str> {
    if certificate.cert_type() != CertType::User {
        return Err("not a user certificate");
    }
    if certificate.public_key().algorithm() != ssh_key::Algorithm::Ed25519 {
        return Err("not an Ed25519 key");
    }
    let fingerprints: Vec<_> = authorities
        .iter()
        .filter(|ca| ca.key_data() == certificate.signature_key())
        .map(|ca| ca.fingerprint(ssh_key::HashAlg::Sha256))
        .collect();
    if fingerprints.is_empty() {
        return Err("Unknown certificate authority");
    }
    certificate
        .validate_at(now, fingerprints.iter())
        .map_err(|_| "invalid certificate")?;
    if !certificate.valid_principals().iter().any(|p| p == device) {
        return Err("certificate is for another device");
    }
    if certificate.key_id() != format!("user:{account}") {
        return Err("certificate is for another account");
    }
    if !certificate.critical_options().is_empty() {
        return Err("certificate carries critical options");
    }
    Ok(())
}

/// Who this host is: its account, its device id and its device key.
pub struct HostIdentity {
    pub account: String,
    pub device: String,
    pub key: PrivateKey,
}
/// The Cloud's SSH authorities (`GET /hosts/ssh-authority`); `refresh`
/// reads them again once, for an authority that rotated.
pub trait Authorities: Send + Sync {
    fn keys(&self, refresh: bool) -> Vec<PublicKey>;
}

/// One connection's folder, and how to end it.
type Open = (String, tokio::sync::watch::Sender<bool>);
/// The host's SSH server.
#[derive(Clone)]
pub struct HostSsh {
    pub identity: Arc<HostIdentity>,
    pub authorities: Arc<dyn Authorities>,
    pub folders: Arc<dyn Folders>,
    pub files: Arc<FileService>,
    pub execution: Option<Arc<dyn super::exec::Execution>>,
    /// The folders' Git, where this computer can run it.
    pub git: Option<Arc<super::git::GitService>>,
    connections: Arc<Mutex<HashMap<u64, Open>>>,
    next: Arc<std::sync::atomic::AtomicU64>,
}
impl HostSsh {
    pub fn new(
        identity: Arc<HostIdentity>,
        authorities: Arc<dyn Authorities>,
        folders: Arc<dyn Folders>,
        execution: Option<Arc<dyn super::exec::Execution>>,
    ) -> Self {
        Self {
            files: Arc::new(FileService::new(folders.clone())),
            identity,
            authorities,
            folders,
            execution,
            git: None,
            connections: Arc::default(),
            next: Arc::default(),
        }
    }
    fn allows(&self, folder: &str, capability: Option<Capability>) -> bool {
        self.folders.resolve(folder).is_some_and(|grant| {
            grant.active && capability.is_none_or(|c| grant.capabilities.contains(&c))
        })
    }
    /// The folders being reached now, one entry per connection.
    pub fn connections(&self) -> Vec<String> {
        self.connections
            .lock()
            .unwrap()
            .values()
            .map(|(folder, _)| folder.clone())
            .collect()
    }
    /// `enforce`: connections to a folder no longer shared here end now,
    /// and with them everything they started.
    pub fn enforce(&self, folder: &str) {
        if self.allows(folder, None) {
            return;
        }
        for (open, stop) in self.connections.lock().unwrap().values() {
            if open == folder {
                let _ = stop.send(true);
            }
        }
    }
    /// Every connection ends (sharing stopped, or "Stop all").
    pub fn close_all(&self) {
        for (_, stop) in self.connections.lock().unwrap().values() {
            let _ = stop.send(true);
        }
    }
    /// Serves one tunnel admitted for `folder` until it closes; `false`
    /// when it is refused at once.
    pub async fn serve<S>(&self, stream: S, folder: String) -> bool
    where
        S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        if uuid::Uuid::parse_str(&folder).is_err()
            || !self.allows(&folder, None)
            || self.connections.lock().unwrap().len() >= MAX_CONNECTIONS
        {
            return false;
        }
        let id = self.next.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let (stop, mut stopped) = tokio::sync::watch::channel(false);
        self.connections
            .lock()
            .unwrap()
            .insert(id, (folder.clone(), stop));
        let config = Arc::new(server::Config {
            server_id: russh::SshId::Standard("SSH-2.0-PuppyOne-Host".into()),
            methods: russh::MethodSet::from(&[russh::MethodKind::PublicKey][..]),
            auth_rejection_time: Duration::from_millis(200),
            auth_rejection_time_initial: Some(Duration::ZERO),
            keys: vec![self.identity.key.clone()],
            inactivity_timeout: Some(Duration::from_secs(35)),
            ..Default::default()
        });
        let handler = Connection {
            host: self.clone(),
            folder,
            channels: HashMap::new(),
            ptys: HashMap::new(),
            env: HashMap::new(),
            sizes: HashMap::new(),
        };
        let served = match server::run_stream(config, stream, handler).await {
            Ok(session) => {
                // Dropping the session ends its channels, and so what they run.
                tokio::select! {
                    _ = session => {}
                    _ = stopped.changed() => {}
                }
                true
            }
            Err(_) => false,
        };
        self.connections.lock().unwrap().remove(&id);
        served
    }
}

/// One SSH connection to the host.
struct Connection {
    host: HostSsh,
    folder: String,
    channels: HashMap<ChannelId, Channel<Msg>>,
    ptys: HashMap<ChannelId, super::exec::Pty>,
    env: HashMap<ChannelId, Vec<(String, String)>>,
    /// The size of each running terminal, which a window change updates.
    sizes: HashMap<ChannelId, tokio::sync::watch::Sender<(u16, u16)>>,
}
impl Connection {
    fn allows(&self, capability: Capability) -> bool {
        self.host.allows(&self.folder, Some(capability))
    }
    fn now() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or_default()
    }
    /// Starts `run` on a session channel through the execution service.
    fn start(
        &mut self,
        id: ChannelId,
        run: super::exec::Run,
        capability: Capability,
        session: &mut Session,
    ) -> Result<(), russh::Error> {
        let pty = self.ptys.get(&id).cloned();
        let needs_pty = !matches!(run, super::exec::Run::Command(_));
        let allowed = self.allows(Capability::Write)
            && self.allows(capability)
            && (pty.is_some() || !needs_pty);
        let Some(execution) = self.host.execution.clone().filter(|_| allowed) else {
            return session.channel_failure(id);
        };
        let Some(channel) = self.channels.remove(&id) else {
            return session.channel_failure(id);
        };
        session.channel_success(id)?;
        let env = self.env.remove(&id).unwrap_or_default();
        let (size, sizes) =
            tokio::sync::watch::channel(pty.as_ref().map_or((80, 24), |p| (p.cols, p.rows)));
        self.sizes.insert(id, size);
        let (folders, folder) = (self.host.folders.clone(), self.folder.clone());
        tokio::spawn(async move {
            super::exec::bridge(execution, folders, folder, run, pty, env, sizes, channel).await
        });
        Ok(())
    }
}
impl server::Handler for Connection {
    type Error = russh::Error;

    async fn auth_publickey_offered(
        &mut self,
        user: &str,
        offer: server::PublicKeyOffer<'_>,
    ) -> Result<Auth, Self::Error> {
        // The offer names only the signature algorithm; a bare key is turned
        // away in `auth_publickey`, so only a certificate signs in.
        let _ = offer;
        Ok(if user == self.folder {
            Auth::Accept
        } else {
            Auth::reject()
        })
    }
    async fn auth_publickey(
        &mut self,
        _: &str,
        _: server::VerifiedPublicKey<'_>,
    ) -> Result<Auth, Self::Error> {
        Ok(Auth::reject())
    }
    async fn auth_openssh_certificate(
        &mut self,
        user: &str,
        certificate: &Certificate,
    ) -> Result<Auth, Self::Error> {
        if user != self.folder || !self.host.allows(&self.folder, None) {
            return Ok(Auth::reject());
        }
        let identity = &self.host.identity;
        let check = |refresh| {
            verify_certificate(
                certificate,
                &self.host.authorities.keys(refresh),
                &identity.device,
                &identity.account,
                Self::now(),
            )
        };
        let verdict = match check(false) {
            // A rotated authority: read the trusted keys again once.
            Err("Unknown certificate authority") => check(true),
            other => other,
        };
        Ok(match verdict {
            Ok(()) => Auth::Accept,
            Err(_) => Auth::reject(),
        })
    }
    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        reply: server::ChannelOpenHandle,
        _: &mut Session,
    ) -> Result<(), Self::Error> {
        self.channels.insert(channel.id(), channel);
        reply.accept().await;
        Ok(())
    }
    async fn subsystem_request(
        &mut self,
        id: ChannelId,
        name: &str,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if name != FILES_SUBSYSTEM || !self.allows(Capability::Read) {
            return session.channel_failure(id);
        }
        let Some(channel) = self.channels.remove(&id) else {
            return session.channel_failure(id);
        };
        session.channel_success(id)?;
        let (host, folder) = (self.host.clone(), self.folder.clone());
        let allow: lines::Allow = {
            let (host, folder) = (host.clone(), folder.clone());
            Arc::new(move |capability| host.allows(&folder, Some(capability)))
        };
        tokio::spawn(lines::serve(
            channel.into_stream(),
            host.files.clone(),
            host.git.clone(),
            folder,
            allow,
        ));
        Ok(())
    }
    #[allow(clippy::too_many_arguments)]
    async fn pty_request(
        &mut self,
        id: ChannelId,
        term: &str,
        cols: u32,
        rows: u32,
        _: u32,
        _: u32,
        _: &[(russh::Pty, u32)],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.ptys.insert(
            id,
            super::exec::Pty {
                term: term.chars().take(64).collect(),
                cols: cols.clamp(1, 1000) as u16,
                rows: rows.clamp(1, 1000) as u16,
            },
        );
        session.channel_success(id)
    }
    async fn env_request(
        &mut self,
        id: ChannelId,
        name: &str,
        value: &str,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if safe_env(name) && value.len() < 256 {
            self.env
                .entry(id)
                .or_default()
                .push((name.to_owned(), value.to_owned()));
            session.channel_success(id)
        } else {
            session.channel_failure(id)
        }
    }
    async fn shell_request(
        &mut self,
        id: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.start(id, super::exec::Run::Shell, Capability::Shell, session)
    }
    async fn exec_request(
        &mut self,
        id: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        let Ok(command) = std::str::from_utf8(data) else {
            return session.channel_failure(id);
        };
        if let Some(launcher) = command.strip_prefix(&format!("{AGENT_COMMAND} ")) {
            let known = super::protocol::LAUNCHERS.contains(&launcher) && launcher != "shell";
            if !known {
                return session.channel_failure(id);
            }
            return self.start(
                id,
                super::exec::Run::Agent(launcher.to_owned()),
                Capability::Agent,
                session,
            );
        }
        if command.is_empty() || command.len() > 64 * 1024 {
            return session.channel_failure(id);
        }
        self.start(
            id,
            super::exec::Run::Command(command.to_owned()),
            Capability::Shell,
            session,
        )
    }
    async fn x11_request(
        &mut self,
        id: ChannelId,
        _: bool,
        _: &str,
        _: &str,
        _: u32,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_failure(id)
    }
    async fn agent_request(&mut self, _: ChannelId, _: &mut Session) -> Result<bool, Self::Error> {
        Ok(false)
    }
    async fn window_change_request(
        &mut self,
        id: ChannelId,
        cols: u32,
        rows: u32,
        _: u32,
        _: u32,
        _: &mut Session,
    ) -> Result<(), Self::Error> {
        if let Some(size) = self.sizes.get(&id) {
            let _ = size.send((cols.clamp(1, 1000) as u16, rows.clamp(1, 1000) as u16));
        }
        Ok(())
    }
}

/// The access side's check of the host: only the registered key.
struct Verifier {
    host_key: PublicKey,
}
impl russh::client::Handler for Verifier {
    type Error = russh::Error;
    async fn check_server_key(
        &mut self,
        key: &russh::keys::PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        Ok(match key {
            russh::keys::PublicKeyOrCertificate::PublicKey { key, .. } => {
                key.key_data() == self.host_key.key_data()
            }
            _ => false,
        })
    }
}

/// One SSH connection to a folder on another computer.
pub struct Access {
    handle: russh::client::Handle<Verifier>,
    files: tokio::sync::Mutex<Option<FilesClient>>,
}
impl Access {
    /// Logs in to `folder` over `stream` with `key` and the certificate the
    /// Cloud issued for it, checking the host against `host_key`.
    pub async fn connect<S>(
        stream: S,
        folder: &str,
        key: PrivateKey,
        certificate: &str,
        host_key: &str,
    ) -> Result<Self, HostError>
    where
        S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        let certificate = Certificate::from_openssh(certificate.trim())
            .map_err(|_| HostError::new("folder_unavailable"))?;
        let host_key = PublicKey::from_openssh(host_key.trim())
            .map_err(|_| HostError::new("folder_unavailable"))?;
        let config = Arc::new(russh::client::Config {
            // Two unanswered keepalives (about 20 s) end a dropped connection.
            keepalive_interval: Some(Duration::from_secs(10)),
            keepalive_max: 2,
            ..Default::default()
        });
        let mut handle = tokio::time::timeout(
            Duration::from_secs(20),
            russh::client::connect_stream(config, stream, Verifier { host_key }),
        )
        .await
        .map_err(|_| HostError::new("device_offline"))?
        .map_err(|_| HostError::new("network_unavailable"))?;
        let auth = handle
            .authenticate_openssh_cert(folder, Arc::new(key), certificate)
            .await
            .map_err(|_| HostError::new("network_unavailable"))?;
        if !auth.success() {
            return Err(HostError::new("folder_unavailable"));
        }
        Ok(Self {
            handle,
            files: tokio::sync::Mutex::new(None),
        })
    }
    pub fn is_closed(&self) -> bool {
        self.handle.is_closed()
    }
    /// The folder's files channel, opened once and reused while open.
    pub async fn files(&self) -> Result<FilesClient, HostError> {
        let mut files = self.files.lock().await;
        if let Some(open) = files.as_ref().filter(|f| f.is_open()) {
            return Ok(open.clone());
        }
        let mut channel = self
            .handle
            .channel_open_session()
            .await
            .map_err(|_| HostError::new("network_unavailable"))?;
        channel
            .request_subsystem(true, FILES_SUBSYSTEM)
            .await
            .map_err(|_| HostError::new("folder_unavailable"))?;
        confirmed(&mut channel)
            .await
            .map_err(|_| HostError::new("folder_unavailable"))?;
        let client = FilesClient::new(channel.into_stream());
        *files = Some(client.clone());
        Ok(client)
    }
    /// A terminal (`launcher` "shell") or an Agent, with a pty.
    pub async fn terminal(
        &self,
        launcher: &str,
        cols: u32,
        rows: u32,
    ) -> Result<Channel<russh::client::Msg>, HostError> {
        let mut channel = self
            .handle
            .channel_open_session()
            .await
            .map_err(|_| HostError::new("network_unavailable"))?;
        channel
            .request_pty(true, "xterm-256color", cols, rows, 0, 0, &[])
            .await
            .map_err(|_| HostError::new("not_allowed"))?;
        confirmed(&mut channel).await?;
        let started = if launcher == "shell" {
            channel.request_shell(true).await
        } else {
            channel
                .exec(true, format!("{AGENT_COMMAND} {launcher}"))
                .await
        };
        started.map_err(|_| HostError::new("not_allowed"))?;
        confirmed(&mut channel).await?;
        Ok(channel)
    }
    /// One command, binary safe, with its exit status.
    pub async fn exec(&self, command: &str) -> Result<Channel<russh::client::Msg>, HostError> {
        let mut channel = self
            .handle
            .channel_open_session()
            .await
            .map_err(|_| HostError::new("network_unavailable"))?;
        channel
            .exec(true, command)
            .await
            .map_err(|_| HostError::new("not_allowed"))?;
        confirmed(&mut channel).await?;
        Ok(channel)
    }
    pub async fn close(&self) {
        let _ = self
            .handle
            .disconnect(russh::Disconnect::ByApplication, "", "")
            .await;
    }
}

/// A terminal or an Agent running on the other computer, as its view
/// reads and drives it.
pub struct RemoteSession(Channel<russh::client::Msg>);
/// What a [`RemoteSession`] says next.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Output {
    Data(Vec<u8>),
    Exit(u32),
    Closed,
}
impl RemoteSession {
    pub async fn next(&mut self) -> Output {
        loop {
            match self.0.wait().await {
                Some(russh::ChannelMsg::Data { data })
                | Some(russh::ChannelMsg::ExtendedData { data, .. }) => {
                    return Output::Data(data.to_vec());
                }
                Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                    return Output::Exit(exit_status);
                }
                Some(russh::ChannelMsg::Close) | None => return Output::Closed,
                Some(_) => {}
            }
        }
    }
    pub async fn input(&self, bytes: &[u8]) {
        let _ = self.0.data(bytes).await;
    }
    pub async fn resize(&self, cols: u16, rows: u16) {
        let _ = self.0.window_change(cols.into(), rows.into(), 0, 0).await;
    }
    pub async fn close(&self) {
        let _ = self.0.close().await;
    }
}
impl Access {
    /// [`Access::terminal`] as a session for a view.
    pub async fn session(
        &self,
        launcher: &str,
        cols: u16,
        rows: u16,
    ) -> Result<RemoteSession, HostError> {
        self.terminal(launcher, cols.into(), rows.into())
            .await
            .map(RemoteSession)
    }
}

/// Waits for the host's answer to the request just sent on `channel`.
async fn confirmed(channel: &mut Channel<russh::client::Msg>) -> Result<(), HostError> {
    loop {
        match channel.wait().await {
            Some(russh::ChannelMsg::Success) => return Ok(()),
            Some(russh::ChannelMsg::Failure) | Some(russh::ChannelMsg::Close) | None => {
                return Err(HostError::new("not_allowed"));
            }
            Some(_) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::files::Grant;
    use super::super::protocol::Request;
    use super::*;
    use core::prelude::v1::test;

    const FOLDER: &str = "6f2c9f43-3c1b-4a8e-9c4e-1a2b3c4d5e6f";
    const DEVICE: &str = "0d9b7f61-1111-4c2a-8b2e-7a6b5c4d3e2f";
    const ACCOUNT: &str = "1e8a6c52-2222-4b3a-9c3f-6b5a4c3d2e1f";

    struct Shared(std::path::PathBuf, Mutex<bool>);
    impl Folders for Shared {
        fn resolve(&self, folder: &str) -> Option<Grant> {
            (folder == FOLDER).then(|| Grant {
                root: self.0.clone(),
                active: *self.1.lock().unwrap(),
                capabilities: vec![
                    Capability::Read,
                    Capability::Write,
                    Capability::Shell,
                    Capability::Agent,
                ],
            })
        }
    }
    struct Ca(PublicKey);
    impl Authorities for Ca {
        fn keys(&self, _: bool) -> Vec<PublicKey> {
            vec![self.0.clone()]
        }
    }
    fn now() -> u64 {
        Connection::now()
    }
    fn certificate(
        ca: &PrivateKey,
        user: &PrivateKey,
        principal: &str,
        key_id: &str,
        window: (u64, u64),
    ) -> String {
        let mut builder = ssh_key::certificate::Builder::new(
            [7u8; 16],
            user.public_key().key_data().clone(),
            window.0,
            window.1,
        )
        .unwrap();
        builder.cert_type(CertType::User).unwrap();
        builder.key_id(key_id).unwrap();
        builder.valid_principal(principal).unwrap();
        builder.extension("permit-pty", "").unwrap();
        builder.sign(ca).unwrap().to_openssh().unwrap()
    }

    /// A folder over SSH end to end, in memory: the certificate from the
    /// authority signs in, the files channel works, and nothing else does.
    #[tokio::test]
    async fn a_folder_is_reached_only_with_the_clouds_certificate_for_this_device() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        std::fs::write(root.join("note.md"), "hello").unwrap();
        let ca = new_key();
        let host_key = new_key();
        let shared = Arc::new(Shared(root.clone(), Mutex::new(true)));
        let host = HostSsh::new(
            Arc::new(HostIdentity {
                account: ACCOUNT.into(),
                device: DEVICE.into(),
                key: host_key.clone(),
            }),
            Arc::new(Ca(ca.public_key().clone())),
            shared.clone(),
            None,
        );
        let window = (now() - 60, now() + 300);
        let connect = |user: PrivateKey, certificate: String, host_line: String| {
            let host = host.clone();
            async move {
                let (a, b) = tokio::io::duplex(256 * 1024);
                tokio::spawn(async move { host.serve(a, FOLDER.into()).await });
                Access::connect(b, FOLDER, user, &certificate, &host_line).await
            }
        };
        let user = new_key();
        let access = connect(
            user.clone(),
            certificate(&ca, &user, DEVICE, &format!("user:{ACCOUNT}"), window),
            public_line(&host_key),
        )
        .await
        .expect("signed in");
        let files = access.files().await.unwrap();
        let read = files
            .request(&Request::Read {
                path: "note.md".into(),
            })
            .await
            .unwrap();
        assert_eq!(read["content_base64"], "aGVsbG8=");
        // No execution service here: a shell is refused, the session lives on.
        assert!(access.terminal("shell", 80, 24).await.is_err());
        assert!(
            files
                .request(&Request::List {
                    path: String::new()
                })
                .await
                .is_ok()
        );
        // Unsharing the folder ends what it allowed.
        *shared.1.lock().unwrap() = false;
        assert_eq!(
            files
                .request(&Request::Read {
                    path: "note.md".into()
                })
                .await
                .unwrap_err()
                .code,
            "folder_unavailable"
        );
        *shared.1.lock().unwrap() = true;
        // Refused: another device, another account, expired, another
        // authority, and a host the Cloud did not register.
        for (principal, key_id, window, signer, host_line) in [
            (
                "other-device",
                format!("user:{ACCOUNT}"),
                window,
                ca.clone(),
                public_line(&host_key),
            ),
            (
                DEVICE,
                "user:someone-else".to_owned(),
                window,
                ca.clone(),
                public_line(&host_key),
            ),
            (
                DEVICE,
                format!("user:{ACCOUNT}"),
                (now() - 600, now() - 300),
                ca.clone(),
                public_line(&host_key),
            ),
            (
                DEVICE,
                format!("user:{ACCOUNT}"),
                window,
                new_key(),
                public_line(&host_key),
            ),
            (
                DEVICE,
                format!("user:{ACCOUNT}"),
                window,
                ca.clone(),
                public_line(&new_key()),
            ),
        ] {
            let user = new_key();
            let refused = connect(
                user.clone(),
                certificate(&signer, &user, principal, &key_id, window),
                host_line,
            )
            .await;
            assert!(refused.is_err(), "{principal} {key_id}");
        }
    }

    /// Runs without a sandbox, for the bridge alone.
    struct Plain;
    impl super::super::exec::Execution for Plain {
        fn prepare(
            &self,
            _: &std::path::Path,
            run: &super::super::exec::Run,
        ) -> Result<super::super::exec::Prepared, &'static str> {
            let args = match run {
                super::super::exec::Run::Command(command) => vec!["-c".into(), command.clone()],
                super::super::exec::Run::Shell => Vec::new(),
                super::super::exec::Run::Agent(_) => return Err("launcher_unavailable"),
            };
            Ok(super::super::exec::Prepared {
                program: "/bin/sh".into(),
                args,
                env: vec![("PATH".into(), "/usr/bin:/bin".into())],
            })
        }
    }
    async fn collect(mut channel: Channel<russh::client::Msg>) -> (String, String, Option<u32>) {
        let (mut out, mut err, mut status) = (Vec::new(), Vec::new(), None);
        while let Some(message) = channel.wait().await {
            match message {
                russh::ChannelMsg::Data { data } => out.extend_from_slice(&data),
                russh::ChannelMsg::ExtendedData { data, ext: 1 } => err.extend_from_slice(&data),
                russh::ChannelMsg::ExitStatus { exit_status } => status = Some(exit_status),
                russh::ChannelMsg::Close => break,
                _ => {}
            }
        }
        (
            String::from_utf8_lossy(&out).into_owned(),
            String::from_utf8_lossy(&err).into_owned(),
            status,
        )
    }

    /// A command and a terminal run in the folder over the session: output,
    /// errors and the exit status come back; an unknown launcher is told why.
    #[tokio::test]
    async fn commands_and_terminals_run_in_the_folder() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let (ca, host_key, user) = (new_key(), new_key(), new_key());
        let host = HostSsh::new(
            Arc::new(HostIdentity {
                account: ACCOUNT.into(),
                device: DEVICE.into(),
                key: host_key.clone(),
            }),
            Arc::new(Ca(ca.public_key().clone())),
            Arc::new(Shared(root.clone(), Mutex::new(true))),
            Some(Arc::new(Plain)),
        );
        let (a, b) = tokio::io::duplex(256 * 1024);
        tokio::spawn(async move { host.serve(a, FOLDER.into()).await });
        let window = (now() - 60, now() + 300);
        let access = Access::connect(
            b,
            FOLDER,
            user.clone(),
            &certificate(&ca, &user, DEVICE, &format!("user:{ACCOUNT}"), window),
            &public_line(&host_key),
        )
        .await
        .unwrap();
        let ran = access.exec("pwd; printf oops >&2; exit 3").await.unwrap();
        let (out, err, status) = collect(ran).await;
        assert_eq!(out.trim(), root.to_string_lossy());
        assert_eq!((err.as_str(), status), ("oops", Some(3)));
        let terminal = access.terminal("shell", 80, 24).await.unwrap();
        terminal
            .data(&b"echo $((40 + 2)); exit 0\n"[..])
            .await
            .unwrap();
        let (out, _, status) = collect(terminal).await;
        assert!(out.contains("42"), "{out}");
        assert_eq!(status, Some(0));
        let agent = access.terminal("codex", 80, 24).await.unwrap();
        let (_, err, status) = collect(agent).await;
        assert!(err.contains("launcher_unavailable"), "{err}");
        assert_eq!(status, Some(126));
    }

    #[test]
    fn only_safe_environment_crosses() {
        for name in ["TERM", "LANG", "LC_ALL", "COLORTERM"] {
            assert!(safe_env(name), "{name}");
        }
        for name in ["PATH", "LD_PRELOAD", "LC_", "lc_all"] {
            assert!(!safe_env(name), "{name}");
        }
    }
}
