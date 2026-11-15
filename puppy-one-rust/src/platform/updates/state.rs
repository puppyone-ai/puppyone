//! `DesktopUpdateState` and the update service's invariant
//! (`enforceMonotonicUpdateState`): a state that offers a version is only
//! ever published for a newer version on this build's channel.
use super::policy::{self, Relation};
use crate::platform::build_identity::Channel;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Disabled,
    Idle,
    Checking,
    NotAvailable,
    Available,
    Downloading,
    Downloaded,
    Installing,
    Error,
}
impl Status {
    /// `ACTIONABLE_UPDATE_STATES`: states that name a version to install.
    pub fn actionable(self) -> bool {
        matches!(
            self,
            Self::Available | Self::Downloading | Self::Downloaded | Self::Installing
        )
    }
    /// `BACKGROUND_CHECK_STATES`.
    pub fn checks_in_background(self) -> bool {
        matches!(self, Self::Idle | Self::NotAvailable | Self::Error)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Progress {
    pub percent: f64,
    pub bytes_per_second: f64,
    pub transferred: f64,
    pub total: f64,
}

/// What the cross-channel or invalid candidate leaves behind.
pub const INVALID_CANDIDATE: &str = "The update feed returned an invalid or cross-channel version.";

#[derive(Clone, Debug, PartialEq)]
pub struct UpdateState {
    pub status: Status,
    pub current_version: String,
    pub channel: Channel,
    pub available_version: Option<String>,
    pub progress: Option<Progress>,
    pub error: Option<String>,
    /// Why updates are disabled.
    pub reason: Option<String>,
    pub automatically_download: bool,
}
impl UpdateState {
    /// `createInitialUpdateState`.
    pub fn new(
        channel: Channel,
        current_version: String,
        reason: Option<String>,
        automatically_download: bool,
    ) -> Self {
        Self {
            status: if reason.is_some() {
                Status::Disabled
            } else {
                Status::Idle
            },
            current_version,
            channel,
            available_version: None,
            progress: None,
            error: None,
            reason,
            automatically_download,
        }
    }
    /// Whether the version this state offers may be installed.
    pub fn candidate_allowed(&self) -> bool {
        policy::evaluate(
            self.channel,
            &self.current_version,
            self.available_version.as_deref(),
        )
        .allowed
    }
    /// `enforceMonotonicUpdateState`: an actionable state for a version that
    /// is not strictly newer on this channel becomes not-available (older or
    /// the same) or an error (invalid or cross-channel).
    pub fn enforce_monotonic(mut self) -> Self {
        if !self.status.actionable() {
            return self;
        }
        let evaluation = policy::evaluate(
            self.channel,
            &self.current_version,
            self.available_version.as_deref(),
        );
        if evaluation.allowed {
            return self;
        }
        let invalid = evaluation.relation == Relation::Invalid || !evaluation.channel_compatible;
        self.status = if invalid {
            Status::Error
        } else {
            Status::NotAvailable
        };
        self.available_version = None;
        self.progress = None;
        self.error = invalid.then(|| INVALID_CANDIDATE.to_owned());
        self
    }
}

/// `getDesktopUpdateTitlebarState`: quieter than Settings; it shows only
/// once there is something to do from the titlebar.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Titlebar {
    /// Automatic downloads are off: the update can be downloaded.
    Available,
    /// Downloaded: restart. What keeps the app open (running sessions,
    /// unsaved documents) is asked about by the quit itself.
    Ready,
    Installing,
}
pub fn titlebar(state: &UpdateState) -> Option<Titlebar> {
    match state.status {
        Status::Available if !state.automatically_download => Some(Titlebar::Available),
        Status::Downloaded => Some(Titlebar::Ready),
        Status::Installing => Some(Titlebar::Installing),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    fn state(status: Status, available: Option<&str>) -> UpdateState {
        UpdateState {
            status,
            available_version: available.map(str::to_owned),
            ..UpdateState::new(Channel::Stable, "0.4.4".into(), None, true)
        }
    }

    /// `desktopUpdateTitlebarModel.test.ts` and the service's monotonic guard.
    #[test]
    fn only_a_newer_same_channel_version_is_ever_offered() {
        let newer = state(Status::Downloaded, Some("0.4.5")).enforce_monotonic();
        assert_eq!(newer.status, Status::Downloaded);
        let same = state(Status::Available, Some("0.4.4")).enforce_monotonic();
        assert_eq!((same.status, same.error), (Status::NotAvailable, None));
        let cross = state(Status::Available, Some("0.4.5-internal.1")).enforce_monotonic();
        assert_eq!(cross.status, Status::Error);
        assert_eq!(cross.error.as_deref(), Some(INVALID_CANDIDATE));
        assert_eq!(cross.available_version, None);
        let idle = state(Status::Idle, None).enforce_monotonic();
        assert_eq!(idle.status, Status::Idle);
    }

    #[test]
    fn the_titlebar_shows_only_what_it_can_act_on() {
        assert_eq!(titlebar(&state(Status::Available, Some("0.4.5"))), None);
        let manual = UpdateState {
            automatically_download: false,
            ..state(Status::Available, Some("0.4.5"))
        };
        assert_eq!(titlebar(&manual), Some(Titlebar::Available));
        assert_eq!(
            titlebar(&state(Status::Downloaded, Some("0.4.5"))),
            Some(Titlebar::Ready)
        );
        assert_eq!(
            titlebar(&state(Status::Installing, Some("0.4.5"))),
            Some(Titlebar::Installing)
        );
        assert_eq!(titlebar(&state(Status::Downloading, Some("0.4.5"))), None);
        let initial = UpdateState::new(Channel::Dev, "0.1.0".into(), Some("off".into()), true);
        assert_eq!(initial.status, Status::Disabled);
    }
}
