//! `useCloudSpaces`, `CloudSpace` (`lib/workspaceHomeModel.ts`) and
//! `spacePresentation.ts`: the spaces an account's Cloud projects live in.
//! An account is a person; a space is ownership: the account's own (default)
//! space beside any number of shared ones (puppy-issues "Accounts and Cloud
//! spaces"). The server states which space is the account's own and whether
//! this account may create projects in each; an old server that does not
//! say the latter is unavailable for grouping, never guessed from a name or
//! a member count.
use super::catalog::Item;
use super::services::{Client, Error, Organization, Result};
use crate::text::locale_compare;

/// `CloudSpace`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Space {
    pub id: String,
    pub name: String,
    /// The account's own space, which reads as "Personal" everywhere.
    pub is_default: bool,
    pub role: Option<String>,
    pub can_manage_space: bool,
    pub can_create_projects: bool,
    /// The plan this space is on, when billing has published one; projects
    /// here use it.
    pub plan_id: Option<String>,
}

/// `can_create_projects` for every space, or nothing: one space the server
/// does not describe makes the whole answer unusable. The account's own
/// space first, then by name and identity.
pub fn from_organizations(organizations: Vec<Organization>) -> Result<Vec<Space>> {
    let mut spaces = organizations
        .into_iter()
        .map(|org| {
            Ok(Space {
                can_create_projects: org.can_create_projects.ok_or(Error::Invalid("spaces"))?,
                id: org.id,
                name: org.name,
                is_default: org.is_default == Some(true),
                role: org.role,
                can_manage_space: org.can_manage_space == Some(true),
                plan_id: org.billing_plan_id,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    spaces.sort_by(|a, b| {
        b.is_default
            .cmp(&a.is_default)
            .then_with(|| locale_compare(&a.name, &b.name))
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(spaces)
}

/// `useCloudSpaces`' read: the organizations, and when none is the
/// account's own a deliberate `POST` that provisions it (the server returns
/// the same one on every call). Old rows are never guessed to be it.
pub fn discover(client: &Client) -> Result<Vec<Space>> {
    let mut organizations = client.organizations()?;
    if !organizations.iter().any(|org| org.is_default == Some(true)) {
        let own = client.ensure_default_space()?;
        organizations.retain(|org| org.id != own.id);
        organizations.push(own);
    }
    from_organizations(organizations)
}

/// `resolveProjectSpace`: the space that holds an open Cloud project, once
/// the account's catalog names it.
pub fn project_space<'a>(
    spaces: &'a [Space],
    project: Option<&str>,
    items: &[Item],
) -> Option<&'a Space> {
    let project = project?;
    let owner = items
        .iter()
        .find(|item| item.cloud_project.as_deref() == Some(project))?
        .cloud_organization
        .as_deref()?;
    spaces.iter().find(|space| space.id == owner)
}

/// `resolveSettingsSpace`: the one space Settings manages: the space its
/// opener named, else the one holding the open Cloud project (`owner`, as
/// the account's catalog names it), else the account's own. It never filters
/// navigation or keeps a global choice.
pub fn settings_space<'a>(
    signed_in: bool,
    spaces: &'a [Space],
    owner: Option<&str>,
    requested: Option<&str>,
) -> Option<&'a Space> {
    if !signed_in {
        return None;
    }
    let find = |id: Option<&str>| id.and_then(|id| spaces.iter().find(|space| space.id == id));
    find(requested)
        .or_else(|| find(owner))
        .or_else(|| spaces.iter().find(|space| space.is_default))
        .or_else(|| spaces.first())
}

/// `SpacePlanKey`: the three plans people choose between.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlanKey {
    Free,
    Team,
    Enterprise,
}
impl PlanKey {
    /// `spacePlanKey`: the plan a space's projects use, from billing's id.
    pub fn of(plan_id: &str) -> Self {
        match plan_id {
            "plus" | "personal" | "team_v2" => Self::Team,
            "business" | "pro" | "team" | "enterprise_v2" | "enterprise" => Self::Enterprise,
            _ => Self::Free,
        }
    }
    /// The key under `onboarding.spaces.plan.*` and `settings.plan.name.*`.
    pub fn key(self) -> &'static str {
        match self {
            Self::Free => "free",
            Self::Team => "team",
            Self::Enterprise => "enterprise",
        }
    }
}

/// `spaceDisplayName`: the account's own space reads as `personal`, never
/// the server's generated name, so it cannot be mistaken for a shared space
/// named after the account.
pub fn display_name<'a>(space: &'a Space, personal: &'a str) -> &'a str {
    if space.is_default {
        personal
    } else {
        &space.name
    }
}

/// `SPACE_MARK_TONES`.
pub const MARK_TONES: u32 = 6;
/// `spaceMarkTone`: one stable tone per space id, so a space looks the same
/// wherever it appears.
pub fn mark_tone(id: &str) -> u32 {
    id.chars()
        .fold(0u32, |hash, c| hash.wrapping_mul(31).wrapping_add(c as u32))
        % MARK_TONES
}
/// `spaceMarkInitial`: the first letter of the space's own name.
pub fn mark_initial(name: &str) -> String {
    name.trim()
        .chars()
        .next()
        .map_or_else(|| "S".to_owned(), |c| c.to_uppercase().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::auth::model::ApiRequest;
    use core::prelude::v1::test;
    use serde_json::{Value, json};
    use std::sync::{Arc, Mutex};

    /// The organizations, and what each provisioning route answers.
    struct Server {
        sent: Mutex<Vec<String>>,
        organizations: Value,
        default_space: Result<Value>,
        personal_space: Value,
    }
    impl super::super::services::Transport for Server {
        fn request(&self, request: ApiRequest) -> Result<Value> {
            self.sent
                .lock()
                .unwrap()
                .push(format!("{} {}", request.method, request.path));
            match request.path.as_str() {
                "/auth/default-space" => self.default_space.clone(),
                "/auth/personal-space" => Ok(self.personal_space.clone()),
                _ => Ok(self.organizations.clone()),
            }
        }
    }
    fn server(organizations: Value, default_space: Result<Value>, personal: Value) -> Arc<Server> {
        Arc::new(Server {
            sent: Default::default(),
            organizations,
            default_space,
            personal_space: personal,
        })
    }
    fn ids(spaces: &[Space]) -> Vec<&str> {
        spaces.iter().map(|s| s.id.as_str()).collect()
    }

    #[test]
    fn a_missing_own_space_is_provisioned_once_and_comes_first() {
        let server = server(
            json!([{"id": "t", "name": "Design", "can_create_projects": true}]),
            Ok(json!({"id": "p", "name": "Alex", "is_default": true,
                "can_create_projects": true, "can_manage_space": true})),
            Value::Null,
        );
        let spaces = discover(&Client::new(server.clone())).unwrap();
        assert_eq!(ids(&spaces), ["p", "t"]);
        assert!(spaces[0].is_default && spaces[0].can_manage_space);
        assert_eq!(
            *server.sent.lock().unwrap(),
            ["GET /organizations/", "POST /auth/default-space"]
        );
    }

    /// Only a deployment without `/auth/default-space` is asked the older
    /// way; what it returns is the account's own space.
    #[test]
    fn an_older_deployment_provisions_the_personal_space_as_the_default() {
        let server = server(
            json!([]),
            Err(Error::Status(404)),
            json!({"id": "p", "name": "Alex", "kind": "personal", "can_create_projects": true}),
        );
        let spaces = discover(&Client::new(server.clone())).unwrap();
        assert_eq!(ids(&spaces), ["p"]);
        assert!(spaces[0].is_default);
        assert_eq!(
            *server.sent.lock().unwrap(),
            [
                "GET /organizations/",
                "POST /auth/default-space",
                "POST /auth/personal-space"
            ]
        );
    }

    #[test]
    fn a_listed_own_space_needs_no_provisioning() {
        let server = server(
            json!([{"id": "p", "name": "Alex", "is_default": true, "can_create_projects": true}]),
            Err(Error::Status(404)),
            Value::Null,
        );
        discover(&Client::new(server.clone())).unwrap();
        assert_eq!(*server.sent.lock().unwrap(), ["GET /organizations/"]);
    }

    /// `cloudApi.client.test.ts`: authentication, permission, conflict and
    /// server failures are never retried the older way.
    #[test]
    fn provisioning_is_not_retried_after_any_other_failure() {
        for status in [401, 403, 409, 500] {
            let server = server(json!([]), Err(Error::Status(status)), Value::Null);
            assert_eq!(
                discover(&Client::new(server.clone())),
                Err(Error::Status(status))
            );
            assert_eq!(
                *server.sent.lock().unwrap(),
                ["GET /organizations/", "POST /auth/default-space"]
            );
        }
    }

    /// `cloudSpacesDiscovery.test.tsx`: a multi-person space can be the
    /// account's default without a separate personal one being made.
    #[test]
    fn a_shared_space_can_be_the_default() {
        let server = server(
            json!([{"id": "personal", "name": "Alex", "is_default": false, "can_create_projects": true},
                {"id": "team", "name": "Design", "is_default": true, "can_create_projects": true}]),
            Err(Error::Status(404)),
            Value::Null,
        );
        let spaces = discover(&Client::new(server.clone())).unwrap();
        assert_eq!(ids(&spaces), ["team", "personal"]);
        assert_eq!(*server.sent.lock().unwrap(), ["GET /organizations/"]);
    }

    #[test]
    fn an_undescribed_space_makes_the_answer_unusable() {
        let server = server(
            json!([{"id": "p", "name": "Alex", "is_default": true, "can_create_projects": true},
                {"id": "o", "name": "Old"}]),
            Err(Error::Status(404)),
            Value::Null,
        );
        assert!(discover(&Client::new(server)).is_err());
    }

    #[test]
    fn spaces_sort_own_first_then_by_name_as_the_product_compares() {
        let org = |id: &str, name: &str, own: bool| Organization {
            id: id.into(),
            name: name.into(),
            is_default: Some(own),
            can_create_projects: Some(false),
            ..Default::default()
        };
        let spaces = from_organizations(vec![
            org("b", "zeta", false),
            org("c", "Alpha", false),
            org("a", "alpha", false),
            org("p", "Zz", true),
        ])
        .unwrap();
        // `localeCompare`: lower case before upper case of the same letter.
        assert_eq!(ids(&spaces), ["p", "a", "c", "b"]);
    }

    /// `settingsSpace.test.ts`.
    fn settings_fixture() -> (Vec<Space>, Vec<Item>) {
        let space = |id: &str, own| Space {
            id: id.into(),
            name: id.to_uppercase(),
            is_default: own,
            can_create_projects: true,
            ..Default::default()
        };
        let item = |id: &str, local: Option<&str>, project: Option<&str>, org: Option<&str>| Item {
            id: id.into(),
            label: id.into(),
            local_path: local.map(str::to_owned),
            cloud_project: project.map(str::to_owned),
            linked: None,
            actions: None,
            modified: None,
            cloud_organization: org.map(str::to_owned),
            host_folder: None,
            remote: None,
        };
        (
            vec![space("a", true), space("b", false)],
            vec![
                item("a1", None, Some("pa"), Some("a")),
                item("b1", None, Some("pb"), Some("b")),
                item("clone", Some("/b"), None, None),
                item("local", Some("/local"), None, None),
            ],
        )
    }
    #[test]
    fn settings_manage_the_named_space_else_the_open_projects_else_the_own() {
        let (spaces, items) = settings_fixture();
        fn owner_in<'a>(items: &'a [Item], project: &str) -> Option<&'a str> {
            items
                .iter()
                .find(|i| i.cloud_project.as_deref() == Some(project))
                .and_then(|i| i.cloud_organization.as_deref())
        }
        let owner = |project: &str| owner_in(&items, project);
        let id = |space: Option<&Space>| space.map(|s| s.id.clone());
        let resolve = |project: Option<&str>, requested| {
            id(settings_space(
                true,
                &spaces,
                project.and_then(owner),
                requested,
            ))
        };
        assert_eq!(resolve(Some("pb"), None).as_deref(), Some("b"));
        assert_eq!(resolve(None, None).as_deref(), Some("a"));
        assert_eq!(resolve(Some("pa"), Some("b")).as_deref(), Some("b"));
        // A requested space the account cannot reach is not chosen.
        assert_eq!(resolve(Some("pb"), Some("gone")).as_deref(), Some("b"));
        assert_eq!(settings_space(false, &spaces, None, Some("b")), None);
        // The open project's space only once the account lists it.
        assert_eq!(
            id(settings_space(true, &spaces[..1], owner("pb"), None)).as_deref(),
            Some("a")
        );
        assert_eq!(
            id(project_space(&spaces, Some("pb"), &items)).as_deref(),
            Some("b")
        );
        assert_eq!(project_space(&spaces[..1], Some("pb"), &items), None);
        assert_eq!(project_space(&spaces, Some("pb"), &items[2..]), None);
        assert_eq!(project_space(&spaces, None, &items), None);
    }

    /// `spacePresentation.test.ts`.
    #[test]
    fn a_space_reads_as_the_product_presents_it() {
        assert_eq!(PlanKey::of("team_v2"), PlanKey::Team);
        assert_eq!(PlanKey::of("plus"), PlanKey::Team);
        assert_eq!(PlanKey::of("personal"), PlanKey::Team);
        assert_eq!(PlanKey::of("team"), PlanKey::Enterprise);
        assert_eq!(PlanKey::of("enterprise_v2"), PlanKey::Enterprise);
        assert_eq!(PlanKey::of("business"), PlanKey::Enterprise);
        assert_eq!(PlanKey::of("free"), PlanKey::Free);
        assert_eq!(PlanKey::of("something-new"), PlanKey::Free);
        let own = Space {
            id: "p".into(),
            name: "alex-7f3".into(),
            is_default: true,
            ..Default::default()
        };
        let shared = Space {
            id: "t".into(),
            name: "Design".into(),
            ..Default::default()
        };
        assert_eq!(display_name(&own, "Personal"), "Personal");
        assert_eq!(display_name(&shared, "Personal"), "Design");
        assert_eq!(mark_initial("  design"), "D");
        assert_eq!(mark_initial("ärzte"), "Ä");
        assert_eq!(mark_initial("   "), "S");
        assert_eq!(mark_initial("设计"), "设");
    }

    /// `spaceMarkTone` over code points with 32-bit wrap, as the product
    /// computes it in JavaScript.
    #[test]
    fn a_space_keeps_one_tone_wherever_it_appears() {
        assert_eq!(mark_tone(""), 0);
        assert_eq!(mark_tone("a"), 97 % 6);
        assert_eq!(mark_tone("ab"), (97 * 31 + 98) % 6);
        let long = "0d9b7f61-1111-4c2a-8b2e-7a6b5c4d3e2f";
        let mut hash: u64 = 0;
        for c in long.chars() {
            hash = (hash * 31 + c as u64) % (1 << 32);
        }
        assert_eq!(mark_tone(long) as u64, hash % 6);
        assert!(mark_tone("😀x") < MARK_TONES);
    }
}
