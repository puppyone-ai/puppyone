//! App-owned public authentication projection. Views never receive credentials.
pub use crate::cloud_auth::Status;
use crate::cloud_auth::{Broker, Environment, Error, Snapshot};
use gpui::*;
use std::sync::Arc;

pub struct CloudAccountService(pub Entity<CloudAccount>);
impl Global for CloudAccountService {}
pub struct CloudAccount {
    pub snapshot: Option<Snapshot>,
    pub unavailable: Option<Error>,
    broker: Option<Arc<Broker>>,
    pub closing: bool,
    close_ready: bool,
    close_error: Option<Error>,
}
impl CloudAccount {
    fn new(enabled: bool, cx: &mut Context<Self>) -> Self {
        let configured = if enabled {
            Environment::configured().and_then(Broker::native)
        } else {
            Err(Error::Unsupported)
        };
        let (broker, browser) = match configured {
            Ok(value) => value,
            Err(error) => {
                return Self {
                    snapshot: None,
                    unavailable: Some(error),
                    broker: None,
                    closing: false,
                    close_ready: true,
                    close_error: None,
                };
            }
        };
        Self::attach(broker, browser, cx)
    }
    fn attach(
        broker: Arc<Broker>,
        browser: async_channel::Receiver<crate::cloud_auth::BrowserEvent>,
        cx: &mut Context<Self>,
    ) -> Self {
        let mut updates = broker.subscribe();
        broker.restore();
        let snapshot = Some(updates.borrow_and_update().clone());
        cx.spawn(async move |this, cx| {
            while updates.changed().await.is_ok() {
                let snapshot = updates.borrow_and_update().clone();
                if this
                    .update(cx, |s, cx| {
                        if s.broker.as_ref().is_some_and(|b| b.current(snapshot.epoch)) {
                            s.snapshot = Some(snapshot);
                            cx.notify();
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
        cx.spawn(async move |this, cx| {
            while let Ok(event) = browser.recv().await {
                if this
                    .update(cx, |s, cx| {
                        if s.broker.as_ref().is_some_and(|b| b.browser_current(&event)) {
                            cx.open_url(&event.url);
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
        let weak = Arc::downgrade(&broker);
        cx.on_app_quit(move |_, _| {
            let completion = weak.upgrade().map(|b| b.shutdown_and_drain());
            async move {
                if let Some(completion) = completion {
                    let _ = completion.recv().await;
                }
            }
        })
        .detach();
        Self {
            snapshot,
            unavailable: None,
            broker: Some(broker),
            closing: false,
            close_ready: false,
            close_error: None,
        }
    }
    fn prepare_close(&mut self, cx: &mut Context<Self>) -> Result<bool, Error> {
        if let Some(error) = self.close_error.take() {
            return Err(error);
        }
        if self.close_ready {
            return Ok(true);
        }
        if !self.closing {
            let Some(broker) = &self.broker else {
                self.close_ready = true;
                return Ok(true);
            };
            self.closing = true;
            let completion = broker.prepare_close();
            cx.spawn(async move |this, cx| {
                let result = completion.recv().await.unwrap_or(Err(Error::SecureStorage));
                let _ = this.update(cx, |s, cx| {
                    s.closing = result.is_ok();
                    s.close_ready = result.is_ok();
                    s.close_error = result.err();
                    cx.notify();
                });
            })
            .detach();
            cx.notify();
        }
        Ok(false)
    }
    fn admitted(&self) -> Option<&Arc<Broker>> {
        self.broker
            .as_ref()
            .filter(|_| !self.closing && !self.close_ready)
    }
    pub fn sign_in(&self) {
        if let Some(broker) = self.admitted() {
            broker.sign_in();
        }
    }
    pub fn sign_out(&self) {
        if let Some(broker) = self.admitted() {
            broker.sign_out();
        }
    }
    pub fn cancel(&self) {
        if let Some(broker) = self.admitted() {
            broker.cancel();
        }
    }
    pub fn reopen(&self) {
        if let Some(broker) = self.admitted() {
            broker.reopen();
        }
    }
    pub fn retry(&self) {
        if let Some(broker) = self.admitted() {
            broker.restore();
        }
    }
}
impl Drop for CloudAccount {
    fn drop(&mut self) {
        if let Some(broker) = &self.broker {
            broker.shutdown();
        }
    }
}
/// The broker and the signed-in binding, for Cloud requests made on the
/// account's behalf (catalog, opening). `None` while signed out.
pub fn broker_and_binding(cx: &App) -> Option<(Arc<Broker>, crate::cloud_auth::model::Binding)> {
    let account = cx.try_global::<CloudAccountService>()?.0.read(cx);
    let binding = account.snapshot.as_ref()?.account.as_ref()?.binding.clone();
    Some((account.broker.clone()?, binding))
}
/// Tests: sign this app in through a fixture broker.
#[cfg(test)]
pub fn install_fixture(
    broker: Arc<Broker>,
    browser: async_channel::Receiver<crate::cloud_auth::BrowserEvent>,
    cx: &mut App,
) -> Entity<CloudAccount> {
    let account = cx.new(|cx| CloudAccount::attach(broker, browser, cx));
    cx.set_global(CloudAccountService(account.clone()));
    account
}
pub fn has_account(cx: &App) -> bool {
    cx.try_global::<CloudAccountService>().is_some_and(|s| {
        s.0.read(cx)
            .snapshot
            .as_ref()
            .is_some_and(|v| v.account.is_some())
    })
}
pub fn close_ready(cx: &App) -> bool {
    cx.try_global::<CloudAccountService>()
        .is_none_or(|s| s.0.read(cx).close_ready)
}
pub fn prepare_close(cx: &mut App) -> Result<bool, Error> {
    let Some(account) = cx.try_global::<CloudAccountService>().map(|s| s.0.clone()) else {
        return Ok(true);
    };
    account.update(cx, |s, cx| s.prepare_close(cx))
}
pub fn install(enabled: bool, cx: &mut App) {
    if !enabled {
        return;
    } // Captures never read the vault or contact a service.
    let model = cx.new(|cx| CloudAccount::new(enabled, cx));
    cx.set_global(CloudAccountService(model));
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[gpui::test]
    fn public_account_projection_observes_restore_and_logout_without_a_native_vault(
        cx: &mut TestAppContext,
    ) {
        cx.executor().allow_parking();
        cx.update(|cx| {
            install(false, cx);
            assert!(cx.try_global::<CloudAccountService>().is_none());
        });
        let (broker, browser) = crate::cloud_auth::account_fixture();
        let account = cx.new(|cx| CloudAccount::attach(broker, browser, cx));
        cx.update(|cx| cx.set_global(CloudAccountService(account.clone())));
        for expected in [Status::Authenticated, Status::SignedOut] {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
            loop {
                cx.run_until_parked();
                if account.read_with(cx, |s, _| {
                    s.snapshot.as_ref().is_some_and(|v| v.status == expected)
                }) {
                    break;
                }
                assert!(std::time::Instant::now() < deadline);
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            account.read_with(cx, |s, _| {
                let snapshot = s.snapshot.as_ref().unwrap();
                if expected == Status::Authenticated {
                    assert_eq!(
                        snapshot.account.as_ref().unwrap().email,
                        "alice@example.test"
                    );
                } else {
                    assert!(snapshot.account.is_none());
                }
            });
            cx.update(|cx| assert_eq!(has_account(cx), expected == Status::Authenticated));
            if expected == Status::Authenticated {
                account.update(cx, |s, _| s.sign_out());
            }
        }
        account.update(cx, |s, cx| assert!(!s.prepare_close(cx).unwrap()));
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
        while !account.read_with(cx, |s, _| s.close_ready) {
            cx.run_until_parked();
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        account.update(cx, |s, cx| {
            assert!(s.prepare_close(cx).unwrap());
            assert!(s.admitted().is_none());
        });
    }
}
