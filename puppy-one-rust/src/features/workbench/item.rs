//! What a tab's content is to the Workbench (`lib/workbench/types.ts`): the
//! generic chrome reads an item's snapshot, saved form and close decision
//! and hosts its view; the contribution that made the item (the Agent chat,
//! the terminal) owns its runtime.
use super::Workbench;
use super::layout::Id;
use super::persistence::RetainedItem;
use futures_util::future::LocalBoxFuture;
use gpui::{AnyElement, AnyView, App, Context, Rgba, Subscription, Window};

/// `AuxiliaryWorkbenchContribution.kind`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ItemKind {
    Chat,
    Terminal,
}

impl ItemKind {
    /// `maximumItems`: 8 Agent Chats and 32 terminals per project.
    pub fn maximum_items(self) -> usize {
        match self {
            Self::Chat => 8,
            Self::Terminal => 32,
        }
    }

    /// `minimumSize`: a chat 280×260, a terminal `terminalLeafMinimumSize`
    /// 188×196.
    pub fn minimum_size(self) -> (f32, f32) {
        match self {
            Self::Chat => (280., 260.),
            Self::Terminal => (188., 196.),
        }
    }
}

/// `AuxiliaryWorkbenchItemSnapshot.status`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ItemStatus {
    Idle,
    Starting,
    Running,
    Exited,
    Error,
}

/// `AuxiliaryWorkbenchItemSnapshot`: what the tab, its overflow row and the
/// History exclusions show of an item.
#[derive(Clone, Debug, PartialEq)]
pub struct ItemSnapshot {
    pub title: String,
    pub accessible_label: String,
    pub detail: Option<String>,
    /// The product mark the generic status shows.
    pub icon_key: Option<String>,
    pub status: ItemStatus,
    pub running: bool,
    /// The feature-owned native resource (an Agent session), never part of
    /// the topology.
    pub resource_id: Option<String>,
}

/// `AuxiliaryWorkbenchCloseDecision`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CloseDecision {
    Close,
    /// A busy item asks first.
    Confirm,
    /// The item cannot go yet; the dialog only keeps it.
    Blocked,
}

/// `AuxiliaryWorkbenchCloseDialogCopy`.
pub struct CloseCopy {
    pub title: String,
    pub detail: &'static str,
    pub action: &'static str,
    /// `{ kind: "blocked" }`: only "Keep … open".
    pub blocked: bool,
}

/// A tab's content, as its contribution provides it.
pub trait WorkbenchItem {
    fn kind(&self) -> ItemKind;
    fn snapshot(&self, cx: &App) -> ItemSnapshot;
    /// The item's content view.
    fn view(&self) -> AnyView;
    /// `renderStatus`: the item's own status mark instead of the generic one
    /// drawn from the snapshot.
    fn status_mark(&self, _tab: Id, _color: Rgba, _cx: &App) -> Option<AnyElement> {
        None
    }
    /// What the project's saved workbench keeps of the item.
    fn retained(&self, cx: &App) -> RetainedItem;
    /// `close.decide`.
    fn close_decision(&self, cx: &App) -> CloseDecision;
    /// The dialog of a `Confirm` (or, `blocked`, a `Blocked`) decision.
    fn close_copy(&self, blocked: bool, title: String) -> CloseCopy;
    /// `close.commit`: `None` releases the item with its tab; otherwise the
    /// tab goes once the future reports the release.
    fn commit_close(&self) -> Option<LocalBoxFuture<'static, bool>> {
        None
    }
    /// `presentation`: whether the tab is shown, and whether it is the shown
    /// tab of the active group.
    fn set_presentation(
        &self,
        _presented: bool,
        _command_target: bool,
        _window: &mut Window,
        _cx: &mut App,
    ) {
    }
    /// `onPresentationChange` and the item's host requests: the Workbench
    /// redraws when the item changes.
    fn watch(&self, cx: &mut Context<Workbench>) -> Subscription;
}
