//! The window executor as the Renderer controllers' [`UiRuntime`]: tasks run
//! on GPUI's foreground executor and timers on its scheduler.
use crate::features::desktop_agent::application::ui_runtime::UiRuntime;
use futures_util::future::LocalBoxFuture;
use gpui::{App, BackgroundExecutor, ForegroundExecutor};
use std::rc::Rc;
use std::time::Duration;

pub struct WindowUiRuntime {
    foreground: ForegroundExecutor,
    background: BackgroundExecutor,
}

impl WindowUiRuntime {
    pub fn create(cx: &App) -> Rc<dyn UiRuntime> {
        Rc::new(Self {
            foreground: cx.foreground_executor().clone(),
            background: cx.background_executor().clone(),
        })
    }
}

impl UiRuntime for WindowUiRuntime {
    fn spawn(&self, task: LocalBoxFuture<'static, ()>) {
        self.foreground.spawn(task).detach();
    }
    fn sleep(&self, ms: u64) -> LocalBoxFuture<'static, ()> {
        Box::pin(self.background.timer(Duration::from_millis(ms)))
    }
    fn now_ms(&self) -> i64 {
        crate::agent::contract::js::now_ms()
    }
}
