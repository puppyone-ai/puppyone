//! The connection surface adapters hold (`connectionFactory(options)` in
//! the product): [`JsonlRpcConnection`] in production, a scripted fake in
//! adapter tests.
use super::jsonl_rpc_connection::{
    ConnectionEvent, ConnectionOptions, JsonlRpcConnection, RequestOptions,
};
use crate::agent::agent_error::AgentResult;
use futures_util::future::LocalBoxFuture;
use serde_json::Value;
use std::rc::Rc;

/// A JSON-RPC peer over a native process.
pub trait RpcConnection {
    /// `connection.request(method, params, options)`.
    fn request(
        &self,
        method: &str,
        params: Value,
        options: RequestOptions,
    ) -> LocalBoxFuture<'static, AgentResult<Value>>;
    /// `connection.notify(method, params)`.
    fn notify(&self, method: &str, params: Option<Value>) -> AgentResult<()>;
    /// `connection.respond(id, result)`.
    fn respond(&self, id: Value, result: Value) -> AgentResult<()>;
    /// `connection.respondError(id, code, message)`.
    fn respond_error(&self, id: Value, code: i64, message: &str) -> AgentResult<()>;
    /// `connection.on(event, listener)` for every event.
    fn on(&self, listener: Rc<dyn Fn(ConnectionEvent)>) -> u64;
    /// `connection.off(event, listener)`.
    fn off(&self, id: u64);
    fn closed(&self) -> bool;
    /// `connection.getDiagnostics()`.
    fn diagnostics(&self) -> String;
    /// `connection.dispose(reason, { expected })`.
    fn dispose(&self, reason: &str, expected: bool);
    /// `connection.waitForExit()`.
    fn wait_for_exit(&self) -> LocalBoxFuture<'static, AgentResult<Value>>;
}

/// `connectionFactory(options)`.
pub type ConnectionFactory = Rc<dyn Fn(ConnectionOptions) -> AgentResult<Rc<dyn RpcConnection>>>;

/// The production factory: `new JsonlRpcConnection(options)`.
pub fn jsonl_rpc_connection_factory() -> ConnectionFactory {
    Rc::new(|options| Ok(Rc::new(JsonlRpcConnection::spawn(options)?) as Rc<dyn RpcConnection>))
}

impl RpcConnection for JsonlRpcConnection {
    fn request(
        &self,
        method: &str,
        params: Value,
        options: RequestOptions,
    ) -> LocalBoxFuture<'static, AgentResult<Value>> {
        let connection = self.clone();
        let method = method.to_string();
        Box::pin(
            async move { JsonlRpcConnection::request(&connection, &method, params, options).await },
        )
    }

    fn notify(&self, method: &str, params: Option<Value>) -> AgentResult<()> {
        JsonlRpcConnection::notify(self, method, params)
    }

    fn respond(&self, id: Value, result: Value) -> AgentResult<()> {
        JsonlRpcConnection::respond(self, id, result)
    }

    fn respond_error(&self, id: Value, code: i64, message: &str) -> AgentResult<()> {
        JsonlRpcConnection::respond_error(self, id, code, message)
    }

    fn on(&self, listener: Rc<dyn Fn(ConnectionEvent)>) -> u64 {
        JsonlRpcConnection::on(self, move |event| listener(event))
    }

    fn off(&self, id: u64) {
        JsonlRpcConnection::off(self, id);
    }

    fn closed(&self) -> bool {
        JsonlRpcConnection::closed(self)
    }

    fn diagnostics(&self) -> String {
        JsonlRpcConnection::diagnostics(self)
    }

    fn dispose(&self, reason: &str, expected: bool) {
        JsonlRpcConnection::dispose(self, reason, expected);
    }

    fn wait_for_exit(&self) -> LocalBoxFuture<'static, AgentResult<Value>> {
        let connection = self.clone();
        Box::pin(async move { JsonlRpcConnection::wait_for_exit(&connection, None).await })
    }
}

/// A scripted connection (the product tests' `FakeConnection`).
#[cfg(test)]
pub mod fake {
    use super::*;
    use crate::agent::agent_error::AgentError;
    use std::cell::{Cell, RefCell};
    use std::collections::HashMap;

    type Listener = Rc<dyn Fn(ConnectionEvent)>;

    /// What a scripted method answers.
    pub type Answer = Rc<dyn Fn(&Value) -> LocalBoxFuture<'static, AgentResult<Value>>>;

    #[derive(Default)]
    pub struct FakeConnection {
        pub closed: Cell<bool>,
        pub requests: RefCell<Vec<Value>>,
        pub responses: RefCell<Vec<Value>>,
        pub errors: RefCell<Vec<Value>>,
        pub notifications: RefCell<Vec<Value>>,
        answers: RefCell<HashMap<String, Answer>>,
        listeners: RefCell<Vec<(u64, Listener)>>,
        /// Each `dispose(reason, expected)`.
        pub disposals: RefCell<Vec<(String, bool)>>,
    }

    impl FakeConnection {
        pub fn new() -> Rc<Self> {
            let connection = Rc::new(Self::default());
            connection.result("initialize", serde_json::json!({ "userAgent": "codex" }));
            connection
        }

        /// `connection.results.set(method, result)`.
        pub fn result(&self, method: &str, result: Value) {
            self.answer(method, move |_| {
                let result = result.clone();
                Box::pin(async move { Ok(result) })
            });
        }

        /// `connection.failures.set(method, error)`.
        pub fn failure(&self, method: &str, error: AgentError) {
            self.answer(method, move |_| {
                let error = error.clone();
                Box::pin(async move { Err(error) })
            });
        }

        /// A method that never answers.
        pub fn pending(&self, method: &str) {
            self.answer(method, |_| Box::pin(futures_util::future::pending()));
        }

        /// `connection.results.set(method, (params) => result)`.
        pub fn answer(
            &self,
            method: &str,
            answer: impl Fn(&Value) -> LocalBoxFuture<'static, AgentResult<Value>> + 'static,
        ) {
            self.answers
                .borrow_mut()
                .insert(method.to_string(), Rc::new(answer));
        }

        /// `connection.emit(event)`.
        pub fn emit(&self, event: ConnectionEvent) {
            let listeners: Vec<Listener> = self
                .listeners
                .borrow()
                .iter()
                .map(|(_, l)| l.clone())
                .collect();
            for listener in listeners {
                listener(event.clone());
            }
        }

        /// The params of each `method` request.
        pub fn requests_of(&self, method: &str) -> Vec<Value> {
            self.requests
                .borrow()
                .iter()
                .filter(|r| r["method"] == method)
                .map(|r| r["params"].clone())
                .collect()
        }

        /// The factory handing out this connection.
        pub fn factory(self: &Rc<Self>) -> ConnectionFactory {
            let connection = self.clone();
            Rc::new(move |_| Ok(connection.clone() as Rc<dyn RpcConnection>))
        }
    }

    impl RpcConnection for FakeConnection {
        fn request(
            &self,
            method: &str,
            params: Value,
            options: RequestOptions,
        ) -> LocalBoxFuture<'static, AgentResult<Value>> {
            self.requests
                .borrow_mut()
                .push(serde_json::json!({ "method": method, "params": params, "timeoutMs": options.timeout_ms }));
            let answer = self.answers.borrow().get(method).cloned();
            match answer {
                Some(answer) => answer(&params),
                None => Box::pin(async { Ok(serde_json::json!({})) }),
            }
        }

        fn notify(&self, method: &str, params: Option<Value>) -> AgentResult<()> {
            self.notifications
                .borrow_mut()
                .push(serde_json::json!({ "method": method, "params": params }));
            Ok(())
        }

        fn respond(&self, id: Value, result: Value) -> AgentResult<()> {
            self.responses
                .borrow_mut()
                .push(serde_json::json!({ "id": id, "result": result }));
            Ok(())
        }

        fn respond_error(&self, id: Value, code: i64, message: &str) -> AgentResult<()> {
            self.errors
                .borrow_mut()
                .push(serde_json::json!({ "id": id, "code": code, "message": message }));
            Ok(())
        }

        fn on(&self, listener: Rc<dyn Fn(ConnectionEvent)>) -> u64 {
            let id = self.listeners.borrow().last().map_or(1, |(id, _)| id + 1);
            self.listeners.borrow_mut().push((id, listener));
            id
        }

        fn off(&self, id: u64) {
            self.listeners
                .borrow_mut()
                .retain(|(listener, _)| *listener != id);
        }

        fn closed(&self) -> bool {
            self.closed.get()
        }

        fn diagnostics(&self) -> String {
            String::new()
        }

        fn dispose(&self, reason: &str, expected: bool) {
            self.disposals
                .borrow_mut()
                .push((reason.to_string(), expected));
            self.closed.set(true);
            self.emit(ConnectionEvent::Exit(
                serde_json::json!({ "expected": expected }),
            ));
        }

        fn wait_for_exit(&self) -> LocalBoxFuture<'static, AgentResult<Value>> {
            Box::pin(async { Ok(serde_json::json!({ "expected": true })) })
        }
    }
}
