//! `runtime/native-persistence-reporter.mjs`: coalesce provider-owned
//! persistence checks. A native turn receipt is not sufficient.
use crate::agent::agent_error::AgentResult;
use crate::agent::event_loop::{SharedTask, shared};
use futures_util::future::LocalBoxFuture;
use serde_json::Value;
use std::cell::{Cell, RefCell};
use std::rc::Rc;

type Verify = Rc<dyn Fn() -> LocalBoxFuture<'static, AgentResult<Option<Value>>>>;

pub struct NativePersistenceReporter {
    verify: Verify,
    report: Rc<dyn Fn(Value)>,
    is_closed: Rc<dyn Fn() -> bool>,
    flight: Rc<RefCell<Option<SharedTask<()>>>>,
    confirmed: Rc<Cell<bool>>,
}

impl NativePersistenceReporter {
    /// `createNativePersistenceReporter({ verify, report, isClosed })`.
    pub fn new(verify: Verify, report: Rc<dyn Fn(Value)>, is_closed: Rc<dyn Fn() -> bool>) -> Self {
        Self {
            verify,
            report,
            is_closed,
            flight: Rc::default(),
            confirmed: Rc::default(),
        }
    }

    /// `reporter.confirm()`.
    pub fn confirm(&self) -> SharedTask<()> {
        if let Some(flight) = self.flight.borrow().clone() {
            return flight;
        }
        if self.confirmed.get() || (self.is_closed)() {
            return shared(async {});
        }
        let (verify, report, is_closed) = (
            self.verify.clone(),
            self.report.clone(),
            self.is_closed.clone(),
        );
        let (flight_slot, confirmed) = (self.flight.clone(), self.confirmed.clone());
        let flight = shared(async move {
            // Unknown persistence remains unverified; discovery can confirm later.
            if let Ok(Some(identity)) = verify().await
                && !is_closed()
            {
                confirmed.set(true);
                report(identity);
            }
            *flight_slot.borrow_mut() = None;
        });
        *self.flight.borrow_mut() = Some(flight.clone());
        crate::agent::event_loop::spawn(flight.clone());
        flight
    }
}
