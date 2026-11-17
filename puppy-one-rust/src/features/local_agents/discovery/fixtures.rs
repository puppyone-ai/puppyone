use crate::agent::installation::installation_service::InstallationService;
use std::rc::Rc;
pub(super) fn service() -> InstallationService {
    use crate::agent::installation::{
        executable_resolver::{Observation, ResolutionContext, SearchContext},
        installation_registry::DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY,
    };
    InstallationService::new(
        DEFAULT_LOCAL_AGENT_INSTALLATION_REGISTRY.clone(),
        Rc::new(|signal| {
            Box::pin(async move {
                Ok(ResolutionContext {
                    environment: Default::default(),
                    environment_source: "test".into(),
                    environment_complete: true,
                    environment_reason_code: None,
                    executable_search: SearchContext::default(),
                    signal: Some(signal),
                })
            })
        }),
        Rc::new(|_, _| {
            Box::pin(async {
                Ok(Observation::NotFound {
                    reason_code: "test".into(),
                })
            })
        }),
        Rc::new(crate::clock::now_ms),
        None,
    )
}
