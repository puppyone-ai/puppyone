//! The terminal: GPUI paints the grid of a PTY session whose process and
//! VT state survive hiding, resizing and tab moves
//! (`desktop-terminal/{model,runtime,interactions,ui}`).
//!
//! - [`model`]: session status, grid metrics, fitting, scrollback
//! - [`view`]: the `TerminalView` entity (keys, IME, selection, links, notices)
//! - [`paint`]: cell painting and the xterm palette
//! - [`interaction`]: viewport selection and xterm mouse encoding
//! - [`queries`]: the terminal replies interactive CLIs ask for
//! - [`glyphs`]: xterm's custom box-drawing and Powerline glyphs
//! - [`activity`]: an Agent CLI's activity signal
use crate::ui::appearance::ActiveAppearance;
use crate::{
    localization::{t as tr, tf},
    platform::terminal::{Event, Terminal},
    theme::Theme,
    wake::Wake,
};
use gpui::{prelude::*, *};
use gpui_kit::base::v_flex;
use std::{
    ops::Range,
    path::PathBuf,
    time::{Duration, Instant},
};
pub(super) mod activity;
mod glyphs;
mod interaction;
mod model;
mod paint;
mod queries;
mod view;

use activity::TerminalActivity;
use interaction::{CellPoint, Link, MouseAction, MouseModifiers, Selection};
use model::*;
pub use model::{SessionStatus, path_label};
use paint::*;
pub use view::TerminalView;
