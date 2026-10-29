//! `useCurrentRepositoryCloudContext` / `projectCloudContext.ts`: which Cloud
//! Project the open local checkout is associated with, resolved afresh from
//! its actual Git remotes and the current account. A resolved context is
//! ephemeral, never a stored folder binding; names never prove association.
//!
//! 1. Remotes: none → local-only; several identities → locator conflict.
//! 2. The locator's origin must be the configured API's (the legacy official
//!    HTTP form only as an in-memory hint) → otherwise wrong host.
//! 3. Without a session the location asks to sign in.
//! 4. `POST /projects/{id}/repository-context` for the exact target, with
//!    401 / 403 / 404 / retryable failures told apart.
use super::{Refusal, Target, authorize_target, locator, recovery};
use crate::cloud_auth::{Broker, Cancellation, Error as AuthError, model::Binding};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Context {
    LocalOnly,
    Resolving,
    Resolved {
        project: String,
        name: String,
    },
    LocatorConflict,
    WrongHost {
        origin: String,
    },
    /// No session, or the session was refused (401).
    WrongAccount,
    NotAuthorized,
    NotFound {
        project: String,
    },
    TemporarilyUnavailable,
    /// The answer named another Project or Scope.
    Mismatch,
    Unresolvable,
}
/// `getProjectCloudLocationState`: what the Header location reports.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CloudState {
    Unavailable,
    Available,
    SignedOut,
    Resolving,
    Attention,
}
impl Context {
    pub fn cloud_state(&self, signed_in: bool) -> CloudState {
        match self {
            Self::Resolved { .. } => CloudState::Available,
            Self::Resolving => CloudState::Resolving,
            Self::LocalOnly => CloudState::Unavailable,
            Self::WrongAccount if !signed_in => CloudState::SignedOut,
            _ => CloudState::Attention,
        }
    }
    /// The resolved Project (`getResolvedCloudProjectId`).
    pub fn project(&self) -> Option<&str> {
        match self {
            Self::Resolved { project, .. } => Some(project),
            _ => None,
        }
    }
    /// The `cloud.message.*` explanation and its `{origin}` argument.
    pub fn message(&self) -> Option<(&'static str, Option<&str>)> {
        Some(match self {
            Self::LocalOnly | Self::Resolving | Self::Resolved { .. } => return None,
            Self::LocatorConflict => ("cloud.message.remote-locator-conflict", None),
            Self::WrongHost { origin } => ("cloud.message.remote-wrong-host", Some(origin)),
            Self::WrongAccount => ("cloud.message.remote-sign-in", None),
            Self::NotAuthorized => ("cloud.message.remote-not-authorized", None),
            Self::NotFound { .. } => ("cloud.message.remote-not-found", None),
            Self::TemporarilyUnavailable => ("cloud.message.remote-network-failed", None),
            Self::Mismatch => ("cloud.message.remote-response-mismatch", None),
            Self::Unresolvable => ("cloud.message.remote-unresolvable", None),
        })
    }
    /// Retry re-runs the query (`temporarily-unavailable` / `error`).
    pub fn retryable(&self) -> bool {
        matches!(
            self,
            Self::TemporarilyUnavailable | Self::Unresolvable | Self::Mismatch
        )
    }
}

/// What the remotes alone decide, or the Project to authorize.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Precheck {
    Decided(Context),
    Authorize(String),
}
/// Steps 1–3 without a request. `urls`: every fetch and push URL.
pub fn precheck<'a>(
    urls: impl IntoIterator<Item = &'a str> + Clone,
    api: Option<&str>,
    hosted_git_origin: Option<&str>,
    signed_in: bool,
) -> Precheck {
    let identities: std::collections::BTreeSet<_> = urls
        .clone()
        .into_iter()
        .filter_map(locator::parse_remote)
        .filter_map(|info| match info {
            locator::RemoteInfo::Project { origin, project } => Some((origin, project, None)),
            locator::RemoteInfo::Scope {
                origin,
                project,
                scope,
            } => Some((origin, project, Some(scope))),
            locator::RemoteInfo::AccessPoint { .. } => None,
        })
        .collect();
    if identities.len() > 1 {
        return Precheck::Decided(Context::LocatorConflict);
    }
    let Some(found) = locator::canonical_locator(urls) else {
        return Precheck::Decided(Context::LocalOnly);
    };
    if !locator::is_trusted_project_locator(&found.origin, api, hosted_git_origin) {
        return Precheck::Decided(Context::WrongHost {
            origin: found.origin,
        });
    }
    if !signed_in {
        return Precheck::Decided(Context::WrongAccount);
    }
    // Hosted Scope workspaces do not open natively; a Scope checkout cannot
    // switch to a Project-wide view either.
    if found.scope.is_some() {
        return Precheck::Decided(Context::Unresolvable);
    }
    Precheck::Authorize(found.project)
}

/// Step 4 on a worker. `Err` carries the failure for recovery decisions.
pub fn authorize(
    broker: &Broker,
    binding: &Binding,
    project: &str,
    cancel: &Cancellation,
) -> Result<Context, (Context, Option<AuthError>)> {
    let target = Target::ProjectRoot {
        project_id: project.to_owned(),
    };
    match authorize_target(broker, binding, &target, &cancel.child()) {
        Ok(context) => Ok(Context::Resolved {
            project: context.project.id,
            name: context.project.name,
        }),
        Err(refusal) => Err(refused(refusal, project)),
    }
}
fn refused(refusal: Refusal, project: &str) -> (Context, Option<AuthError>) {
    let error = match refusal {
        Refusal::Auth(error) => error,
        Refusal::Invalid => return (Context::Mismatch, None),
        Refusal::Unreadable => return (Context::NotAuthorized, None),
    };
    let context = match error {
        // A new session resolves again under its own key.
        AuthError::SessionChanged | AuthError::Cancelled => Context::Resolving,
        AuthError::InvalidCredentials | AuthError::Http(401) => Context::WrongAccount,
        AuthError::Http(403) | AuthError::Service(403, _) => Context::NotAuthorized,
        AuthError::Http(404) | AuthError::Service(404, _) => Context::NotFound {
            project: project.to_owned(),
        },
        ref other if recovery::recoverable(other) || matches!(other, AuthError::Response(..)) => {
            Context::TemporarilyUnavailable
        }
        _ => Context::Unresolvable,
    };
    (context, Some(error))
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    const API: &str = "https://api.puppyone.ai/api/v1";
    const PROJECT: &str = "https://api.puppyone.ai/git/0d3b7a4e-1f2a-4b5c-8d9e-0123456789ab.git";

    #[test]
    fn remotes_decide_before_any_request() {
        let none: [&str; 1] = ["https://github.com/a/b.git"];
        assert_eq!(
            precheck(none, Some(API), None, true),
            Precheck::Decided(Context::LocalOnly)
        );
        let found = precheck([PROJECT], Some(API), None, true);
        let Precheck::Authorize(project) = found else {
            panic!("{found:?}")
        };
        assert_eq!(project, "0d3b7a4e-1f2a-4b5c-8d9e-0123456789ab");
        assert_eq!(
            precheck([PROJECT], Some(API), None, false),
            Precheck::Decided(Context::WrongAccount)
        );
        assert!(matches!(
            precheck(
                [PROJECT],
                Some("https://api.example.test/api/v1"),
                None,
                true
            ),
            Precheck::Decided(Context::WrongHost { .. })
        ));
        let other = "https://api.puppyone.ai/git/11111111-1f2a-4b5c-8d9e-0123456789ab.git";
        assert_eq!(
            precheck([PROJECT, other], Some(API), None, true),
            Precheck::Decided(Context::LocatorConflict)
        );
    }

    #[test]
    fn refusals_are_told_apart_and_mapped_to_location_states() {
        let p = "p";
        let state = |r| refused(r, p).0;
        assert_eq!(
            state(Refusal::Auth(AuthError::Http(401))),
            Context::WrongAccount
        );
        assert_eq!(
            state(Refusal::Auth(AuthError::Http(403))),
            Context::NotAuthorized
        );
        assert_eq!(
            state(Refusal::Auth(AuthError::Http(404))),
            Context::NotFound { project: p.into() }
        );
        assert_eq!(
            state(Refusal::Auth(AuthError::Response(503, None))),
            Context::TemporarilyUnavailable
        );
        assert_eq!(
            state(Refusal::Auth(AuthError::Unavailable)),
            Context::TemporarilyUnavailable
        );
        assert_eq!(state(Refusal::Invalid), Context::Mismatch);
        assert_eq!(state(Refusal::Unreadable), Context::NotAuthorized);
        assert_eq!(
            state(Refusal::Auth(AuthError::SessionChanged)),
            Context::Resolving
        );
        assert_eq!(
            Context::WrongAccount.cloud_state(false),
            CloudState::SignedOut
        );
        assert_eq!(
            Context::WrongAccount.cloud_state(true),
            CloudState::Attention
        );
        assert_eq!(
            Context::LocalOnly.cloud_state(true),
            CloudState::Unavailable
        );
        assert_eq!(
            Context::Resolved {
                project: p.into(),
                name: "Docs".into()
            }
            .cloud_state(true),
            CloudState::Available
        );
        assert_eq!(
            Context::WrongHost {
                origin: "https://x".into()
            }
            .message(),
            Some(("cloud.message.remote-wrong-host", Some("https://x")))
        );
    }
}
