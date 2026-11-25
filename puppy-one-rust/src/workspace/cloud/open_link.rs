//! The app's own link to a Cloud project (and, from a chat app's "Open in
//! PuppyOne", to one of its hosted Agent conversations):
//! `<scheme>://cloud/projects/{project_id}[?session={session_id}]`. A link
//! only names what to open; whether the person may see it is the Cloud's
//! answer to the ordinary opening.

/// What a well-formed link names.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectLink {
    pub project: String,
    /// The hosted Agent conversation to show; `None` when the link names no
    /// usable one (a malformed id is the same as none).
    pub session: Option<String>,
}

/// Whether `url` is this scheme's Cloud link at all (well formed or not): a
/// malformed one is still ours to ignore, not another handler's.
pub fn is_project_link(url: &str, scheme: &str) -> bool {
    url.strip_prefix(scheme)
        .and_then(|rest| rest.strip_prefix("://cloud/"))
        .is_some()
}

/// `<scheme>://cloud/projects/{project_id}?session={session_id}`. Ids follow
/// the rules of the Cloud client's own path segments, so nothing that would
/// need escaping reaches a request. `None` for any other host, path or id.
pub fn parse(url: &str, scheme: &str) -> Option<ProjectLink> {
    if url.len() > 2048 {
        return None;
    }
    let url = url::Url::parse(url.trim()).ok()?;
    if url.scheme() != scheme
        || url.host_str() != Some("cloud")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let project = url.path().strip_prefix("/projects/")?;
    if !super::model::identifier(project) {
        return None;
    }
    let mut sessions = url.query_pairs().filter(|(key, _)| key == "session");
    let session = sessions
        .next()
        .filter(|_| sessions.next().is_none())
        .map(|(_, value)| value.into_owned())
        .filter(|value| super::agent::segment(value).is_ok());
    Some(ProjectLink {
        project: project.to_owned(),
        session,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    const SCHEME: &str = "puppyone-development";

    fn link(project: &str, session: Option<&str>) -> Option<ProjectLink> {
        Some(ProjectLink {
            project: project.into(),
            session: session.map(Into::into),
        })
    }

    #[test]
    fn a_project_link_names_its_project_and_conversation() {
        assert_eq!(
            parse(
                "puppyone-development://cloud/projects/4b0e-11ef?session=sess_1",
                SCHEME
            ),
            link("4b0e-11ef", Some("sess_1"))
        );
        assert_eq!(
            parse("puppyone-development://cloud/projects/p1", SCHEME),
            link("p1", None)
        );
    }

    #[test]
    fn a_session_that_is_missing_or_unusable_just_leaves_the_project() {
        for url in [
            "puppyone-development://cloud/projects/p1?session=",
            "puppyone-development://cloud/projects/p1?session=a%2Fb",
            "puppyone-development://cloud/projects/p1?session=..",
            "puppyone-development://cloud/projects/p1?session=a&session=b",
            "puppyone-development://cloud/projects/p1?other=x",
        ] {
            assert_eq!(parse(url, SCHEME), link("p1", None), "{url}");
        }
    }

    #[test]
    fn other_hosts_paths_schemes_and_bad_ids_are_not_project_links() {
        for url in [
            "puppyone-development://templates/projects/p1",
            "puppyone-development://cloud/project/p1",
            "puppyone-development://cloud/projects/",
            "puppyone-development://cloud/projects/p1/extra",
            "puppyone-development://cloud/projects/a_b",
            "puppyone-development://cloud/projects/a%2Fb",
            "puppyone-development://cloud/projects/..",
            "puppyone-development://user@cloud/projects/p1",
            "puppyone-development://cloud:80/projects/p1",
            "puppyone-development://cloud/projects/p1#x",
            "puppyone://cloud/projects/p1",
            "https://cloud/projects/p1",
            "not a url",
        ] {
            assert_eq!(parse(url, SCHEME), None, "{url}");
        }
        let long = format!("puppyone-development://cloud/projects/{}", "a".repeat(101));
        assert_eq!(parse(&long, SCHEME), None);
    }

    #[test]
    fn only_this_schemes_cloud_links_are_claimed() {
        assert!(is_project_link(
            "puppyone-development://cloud/projects/..",
            SCHEME
        ));
        assert!(!is_project_link("puppyone://cloud/projects/p1", SCHEME));
        assert!(!is_project_link(
            "puppyone-development://templates/import",
            SCHEME
        ));
    }
}
