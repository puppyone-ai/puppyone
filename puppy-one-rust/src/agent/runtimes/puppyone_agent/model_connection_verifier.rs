//! `runtimes/puppyone-agent/model-connection-verifier.mjs`: an explicit
//! synthetic inference test. No project content and no actual tool
//! execution.
use super::model_connection_binding::spawn_with_model_configuration;
use super::puppyone_agent_discovery::PUPPYONE_AGENT_WORKER_PATH;
use super::puppyone_agent_environment::build_puppyone_agent_environment;
use crate::agent::agent_error::AgentResult;
use crate::agent::event_loop::AbortSignal;
use crate::model_connections::schema::connection_error;
use futures_util::future::LocalBoxFuture;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::Duration;
use tokio::io::AsyncReadExt;

/// `verifyModel(configuration, { signal })`.
pub type ModelVerifier =
    Rc<dyn Fn(Value, Option<AbortSignal>) -> LocalBoxFuture<'static, AgentResult<()>>>;

/// `createPuppyOneModelVerifier({ appPath, userDataPath, executablePath })`.
pub fn create_puppyone_model_verifier(
    app_path: &Path,
    user_data_path: &Path,
    executable_path: Option<PathBuf>,
) -> ModelVerifier {
    let (app_path, user_data_path) = (app_path.to_path_buf(), user_data_path.to_path_buf());
    let executable_path = executable_path
        .or_else(|| std::env::current_exe().ok())
        .unwrap_or_default();
    Rc::new(move |configuration, signal| {
        let (app_path, user_data_path, executable_path) = (
            app_path.clone(),
            user_data_path.clone(),
            executable_path.clone(),
        );
        Box::pin(async move {
            if signal.as_ref().is_some_and(AbortSignal::aborted) {
                return Err(connection_error("CANCELLED"));
            }
            let profile = user_data_path.join("agent-runtime/puppyone-agent");
            let environment = build_puppyone_agent_environment(
                &std::env::vars().collect(),
                &profile.to_string_lossy(),
                crate::platform::common::bounded_process_probe::node_platform(),
            )?;
            let spawn = spawn_with_model_configuration(configuration, None);
            let mut io = spawn(
                &crate::agent::transports::jsonl_rpc_connection::ConnectionOptions {
                    executable_path,
                    args: vec![
                        app_path
                            .join(PUPPYONE_AGENT_WORKER_PATH)
                            .to_string_lossy()
                            .into_owned(),
                        "--verify-model".into(),
                    ],
                    cwd: app_path.clone(),
                    env: Some(environment.into_iter().collect()),
                    ..Default::default()
                },
            )?;
            let kill = io.kill.clone();
            let mut stdout = std::mem::replace(&mut io.stdout, Box::new(tokio::io::empty()));
            // Drain stderr, but never log supplier errors or credentials.
            let mut stderr = std::mem::replace(&mut io.stderr, Box::new(tokio::io::empty()));
            crate::agent::event_loop::spawn(async move {
                let mut sink = Vec::new();
                let _ = stderr.read_to_end(&mut sink).await;
            });
            let read = async {
                let mut output = Vec::new();
                let mut buffer = [0u8; 512];
                loop {
                    match stdout.read(&mut buffer).await {
                        Ok(0) | Err(_) => return Some(output),
                        Ok(read) => {
                            output.extend_from_slice(&buffer[..read]);
                            if output.len() > 1024 {
                                return None;
                            }
                        }
                    }
                }
            };
            let cancelled = async {
                match signal.as_ref() {
                    Some(signal) => {
                        signal.aborted_reason().await;
                    }
                    None => futures_util::future::pending::<()>().await,
                }
            };
            let outcome = tokio::select! {
                output = read => output,
                _ = tokio::time::sleep(Duration::from_millis(65_000)) => None,
                () = cancelled => None,
            };
            let stopped = outcome.is_none();
            if stopped {
                kill(false);
                let kill = kill.clone();
                drop(crate::agent::event_loop::set_timeout(2_000, move || {
                    kill(true);
                }));
            }
            let (code, _, _) = io.exit.await;
            // Timeout, cancellation and an oversized answer all stop the worker.
            match outcome {
                Some(output)
                    if code == Some(0)
                        && String::from_utf8_lossy(&output).trim() == r#"{"verified":true}"# =>
                {
                    Ok(())
                }
                _ if stopped => Err(connection_error("CANCELLED")),
                _ => Err(connection_error("VERIFICATION_FAILED")),
            }
        })
    })
}
