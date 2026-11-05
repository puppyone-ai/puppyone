//! `runtimes/workbuddy/workbuddy-acp-adapter.mjs`: WorkBuddy product and
//! profile policy around the shared ACP runtime core.
use super::workbuddy_channels::WorkBuddyChannel;
use super::workbuddy_config_directory::work_buddy_config_directory;
use super::workbuddy_environment::WORKBUDDY_HOST_ENVIRONMENT;
use super::workbuddy_history_source::work_buddy_history_source;
use crate::agent::agent_error::AgentResult;
use crate::agent::node_path;
use crate::agent::protocols::acp::acp_client::AcpClient;
use crate::agent::protocols::acp::acp_runtime_adapter::{AcpAdapterOptions, AcpRuntimeAdapter};
use crate::agent::runtimes::hermes::hermes_acp_adapter::{
    readiness_args_prefix, readiness_environment,
};
use crate::agent::transports::jsonl_rpc_connection::rpc_error_code;
use serde_json::{Map, Value};
use std::rc::Rc;

/// `new WorkBuddyAcpAdapter({ channel, ...options })`.
pub fn work_buddy_acp_adapter(
    channel: WorkBuddyChannel,
    mut options: AcpAdapterOptions,
) -> AgentResult<AcpRuntimeAdapter> {
    let environment = readiness_environment(&options.readiness);
    options.source_scope_id = Some(work_buddy_history_source(
        &channel,
        &environment,
        &node_path::homedir(),
    ));
    options.account_type = Some(channel.id.into());
    options.created_title = Some(format!("New {} session", channel.display_name));
    options.resumed_title = Some(format!("{} session", channel.display_name));
    options.authentication_method_id = Some(channel.authentication_method_id.into());
    options.is_already_authenticated = Some(Rc::new(|client, _| {
        Box::pin(async move { work_buddy_is_already_authenticated(&client).await })
    }));
    let args_prefix = readiness_args_prefix(&options.readiness);
    options.process_args = Some(Rc::new(move |_, _, _| {
        let mut args = args_prefix.clone();
        args.push("--acp".into());
        args
    }));
    options.environment_overlay =
        Some(Rc::new(move |environment: &Map<String, Value>, _, _, _| {
            let read = |key: &str| {
                environment
                    .get(key)
                    .and_then(Value::as_str)
                    .map(str::to_string)
            };
            let directory = work_buddy_config_directory(&channel, &read, &node_path::homedir())
                .to_string_lossy()
                .into_owned();
            let mut overlay: Map<String, Value> = WORKBUDDY_HOST_ENVIRONMENT
                .iter()
                .map(|(key, value)| (key.to_string(), Value::from(*value)))
                .collect();
            overlay.insert(
                "WORKBUDDY_CONFIG_DIR".into(),
                Value::from(directory.as_str()),
            );
            overlay.insert("CODEBUDDY_CONFIG_DIR".into(), Value::from(directory));
            overlay.insert(
                "CODEBUDDY_INTERNET_ENVIRONMENT".into(),
                Value::from(channel.route),
            );
            Value::Object(overlay)
        }));
    options.event_source = Some(format!("{}-acp", channel.id));
    options.embedded_text = true;
    AcpRuntimeAdapter::new(options)
}

/// Older ACP builds may not expose the read-only identity extension; they
/// keep the previous explicit-authentication behavior as a safe fallback.
async fn work_buddy_is_already_authenticated(client: &AcpClient) -> AgentResult<bool> {
    match client
        .request_extension("_codebuddy.ai/getUserInfo", serde_json::json!({}), None)
        .await
    {
        Ok(response) => Ok(response.get("userInfo").is_some_and(Value::is_object)),
        Err(error) if rpc_error_code(&error) == Some(-32601) => Ok(false),
        Err(error) => Err(error),
    }
}
