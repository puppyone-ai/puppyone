//! `useCloudAgentWorkspace` and `CloudAgentWorkbench.prepare`: the hosted
//! targets' Hubs (one per binding and workbench), the location shown, and
//! its chats and History.
use super::conversation::CloudAgentConversation;
use super::item::CloudAgentItem;
use super::{CloudAgentController, HostedHistory, Hub, INSTALLATION_ID, LABEL, storage_dir};
use crate::agent::connections::legacy_local_agent_inventory::Installation;
use crate::agent::connections::legacy_runtime_registry::Runtime;
use crate::features::desktop_agent::HistoryBrowser;
use crate::wake::Wake;
use crate::workspace::cloud::agent::{AgentTarget, BrokerTransport, Client, Session};
use gpui::{App, AppContext as _, Entity, Window};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::Arc;

/// `CLOUD_AGENT_LABEL`'s creation recipe: the only runtime a Cloud launcher
/// offers (no local discovery, no terminal).
pub fn hosted_installation() -> Installation {
    Installation {
        runtime: Runtime::PuppyOne,
        id: INSTALLATION_ID,
        label: LABEL.into(),
        executable: PathBuf::new(),
        chat: true,
    }
}

/// The hosted Agent's location in one window.
#[derive(Default)]
pub struct HostedChats {
    /// The hosted location shown, and the Hubs of the targets seen (by
    /// storage, account binding and workbench).
    hosted: Option<Arc<Hub>>,
    hubs: HashMap<String, Arc<Hub>>,
}

impl HostedChats {
    /// The hosted Project's Agent: tabs persist per API, account and
    /// target; one Hub per binding and workbench. The Workbench location of
    /// its tabs.
    pub fn open(&mut self, target: AgentTarget, published: Box<dyn Fn() + Send + Sync>) -> PathBuf {
        let identity = format!(
            "{}#{}#{}#{}",
            target.storage, target.binding.instance, target.binding.epoch, target.workbench
        );
        let hub = self
            .hubs
            .entry(identity)
            .or_insert_with(|| {
                let transport = Arc::new(BrokerTransport {
                    broker: target.broker.clone(),
                    binding: target.binding.clone(),
                    cancel: Default::default(),
                    wait: crate::workspace::cloud::agent::BATCH_WAIT,
                });
                Hub::new(
                    Client::new(transport, target.project.clone(), target.workbench.clone()),
                    target.storage.clone(),
                    storage_dir(),
                    published,
                )
            })
            .clone();
        self.hosted = Some(hub);
        PathBuf::from(format!(
            "puppyone-cloud-agent-{}",
            blake3::hash(target.storage.as_bytes()).to_hex()
        ))
    }

    /// The hosted location over `hub`.
    #[cfg(test)]
    pub fn open_hub(&mut self, hub: Arc<Hub>) {
        self.hosted = Some(hub);
    }

    /// A local project is shown.
    pub fn close(&mut self) {
        self.hosted = None;
    }

    /// Whether the hosted Agent is shown.
    pub fn is_open(&self) -> bool {
        self.hosted.is_some()
    }

    /// `CloudAgentWorkbench.prepare(id, session)`: a hosted chat of the
    /// location `root` whose receipts persist under `key`; a History
    /// `session` opens it.
    pub fn chat(
        &mut self,
        root: &Path,
        key: &str,
        session: Option<Session>,
        window: &mut Window,
        cx: &mut App,
    ) -> Result<CloudAgentItem, String> {
        self.chat_with_prompt(root, key, session, None, window, cx)
    }

    /// Creates a hosted chat tab and optionally submits an initial prompt right
    /// away (used by the L1 composer-first launcher).
    pub fn chat_with_prompt(
        &mut self,
        root: &Path,
        key: &str,
        session: Option<Session>,
        initial_prompt: Option<String>,
        window: &mut Window,
        cx: &mut App,
    ) -> Result<CloudAgentItem, String> {
        let hub = self
            .hosted
            .clone()
            .ok_or_else(|| String::from("The hosted Agent is not open."))?;
        let (wake, changes) = Wake::channel();
        let chat = CloudAgentController::new(hub, key, session, wake)?;
        if let Some(prompt) = initial_prompt.filter(|p| !p.trim().is_empty()) {
            chat.submit(prompt);
        }
        let conversation = cx.new(|cx| CloudAgentConversation::new(chat, changes, window, cx));
        Ok(CloudAgentItem::new(conversation, root.to_path_buf()))
    }

    /// The hosted History's conversation `id`.
    pub fn session(&self, id: &str) -> Option<Session> {
        self.hosted
            .as_ref()?
            .history()
            .sessions
            .into_iter()
            .find(|s| s.id == id)
    }

    /// Cached hosted recent sessions (pure memory/disk read, no network calls).
    pub fn cached_recent_sessions(
        &self,
        excluded: &[String],
        limit: usize,
    ) -> Vec<crate::agent::contract::dto::SessionMetadata> {
        let Some(hub) = self.hosted.as_ref() else {
            return Vec::new();
        };
        hub.history()
            .sessions
            .into_iter()
            .filter(|s| !excluded.contains(&s.id))
            .take(limit)
            .map(|s| crate::agent::contract::dto::SessionMetadata {
                id: s.id,
                title: s.title.unwrap_or_else(|| LABEL.into()),
                updated_at: s.updated_at,
                updated_at_known: Some(true),
                runtime_id: Some(super::conversation::HOSTED_RUNTIME_ID.into()),
                ..Default::default()
            })
            .collect()
    }

    /// `CloudAgentHistory`: the hosted target's locators, which need no
    /// discovery permission.
    pub fn history_browser(
        &self,
        window: &mut Window,
        cx: &mut App,
    ) -> Option<Entity<HistoryBrowser>> {
        let hub = self.hosted.clone()?;
        Some(cx.new(|cx| HistoryBrowser::new(Rc::new(HostedHistory(hub)), true, window, cx)))
    }
}
