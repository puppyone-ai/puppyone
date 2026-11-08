//! `useCloudSpaces` and `CloudSpace` (`lib/workspaceHomeModel.ts`): the
//! spaces an account's Cloud projects live in. An account is a person; a
//! space is ownership: one personal space each, beside any number of team
//! spaces (puppy-issues "Accounts and Cloud spaces"). The server states each
//! space's kind and whether this account may create projects in it; an old
//! server that does not is unavailable for grouping, never guessed from a
//! name or a member count.
use super::services::{Client, Error, Organization, Result};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Kind {
    Personal,
    Team,
}
/// `CloudSpace`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Space {
    pub id: String,
    pub name: String,
    pub kind: Kind,
    pub can_create_projects: bool,
}

/// `kind` and `can_create_projects` for every space, or nothing: one space
/// the server does not describe makes the whole answer unusable.
pub fn from_organizations(organizations: Vec<Organization>) -> Result<Vec<Space>> {
    let mut spaces = organizations
        .into_iter()
        .map(|org| {
            let kind = match org.kind.as_deref() {
                Some("personal") => Kind::Personal,
                Some("team") => Kind::Team,
                _ => return Err(Error::Invalid("spaces")),
            };
            let can_create_projects = org.can_create_projects.ok_or(Error::Invalid("spaces"))?;
            Ok(Space {
                id: org.id,
                name: org.name,
                kind,
                can_create_projects,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    // The personal space first, then by name and identity.
    spaces.sort_by(|a, b| {
        (b.kind == Kind::Personal)
            .cmp(&(a.kind == Kind::Personal))
            .then_with(|| a.name.cmp(&b.name))
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(spaces)
}

/// `useCloudSpaces`' read: the organizations, and when none is personal a
/// deliberate `POST` that provisions it (the server returns the same one on
/// every call).
pub fn discover(client: &Client) -> Result<Vec<Space>> {
    let mut organizations = client.organizations()?;
    if !organizations
        .iter()
        .any(|org| org.kind.as_deref() == Some("personal"))
    {
        let personal = client.ensure_personal_space()?;
        organizations.retain(|org| org.id != personal.id);
        organizations.push(personal);
    }
    from_organizations(organizations)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::auth::model::ApiRequest;
    use core::prelude::v1::test;
    use serde_json::{Value, json};
    use std::sync::{Arc, Mutex};

    struct Server(Mutex<Vec<String>>, Value, Value);
    impl super::super::services::Transport for Server {
        fn request(&self, request: ApiRequest) -> Result<Value> {
            self.0
                .lock()
                .unwrap()
                .push(format!("{} {}", request.method, request.path));
            Ok(if request.path == "/auth/personal-space" {
                self.2.clone()
            } else {
                self.1.clone()
            })
        }
    }

    #[test]
    fn a_missing_personal_space_is_provisioned_once_and_comes_first() {
        let server = Arc::new(Server(
            Default::default(),
            json!([{"id": "t", "name": "Design", "kind": "team", "can_create_projects": true}]),
            json!({"id": "p", "name": "Alex", "kind": "personal", "can_create_projects": true}),
        ));
        let spaces = discover(&Client::new(server.clone())).unwrap();
        assert_eq!(
            spaces.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            ["p", "t"]
        );
        assert_eq!(
            *server.0.lock().unwrap(),
            ["GET /organizations/", "POST /auth/personal-space"]
        );
    }

    #[test]
    fn an_undescribed_space_makes_the_answer_unusable() {
        let server = Arc::new(Server(
            Default::default(),
            json!([{"id": "p", "name": "Alex", "kind": "personal", "can_create_projects": true},
                {"id": "o", "name": "Old"}]),
            Value::Null,
        ));
        assert!(discover(&Client::new(server)).is_err());
    }

    #[test]
    fn spaces_sort_personal_then_by_name() {
        let org = |id: &str, name: &str, kind: &str| Organization {
            id: id.into(),
            name: name.into(),
            kind: Some(kind.into()),
            can_create_projects: Some(false),
            plan: String::new(),
            seat_limit: 0,
        };
        let spaces = from_organizations(vec![
            org("b", "Zeta", "team"),
            org("a", "Alpha", "team"),
            org("p", "Me", "personal"),
        ])
        .unwrap();
        assert_eq!(
            spaces.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            ["p", "a", "b"]
        );
    }
}
