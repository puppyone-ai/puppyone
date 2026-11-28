//! Aspect-fit screen geometry and GPUI keyboard/mouse translation to X11
//! keysyms and RFB button masks (`RFC 6143` §7.5.4–7.5.5).
use super::rfb::RfbCommand;
use gpui::{Bounds, Keystroke, Modifiers, MouseButton, Pixels, Point};

pub(super) const XK_SHIFT_L: u32 = 0xffe1;
pub(super) const XK_CONTROL_L: u32 = 0xffe3;
pub(super) const XK_ALT_L: u32 = 0xffe9;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct FitRect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

/// Computes the centered `object-fit: contain` rectangle inside `(vw, vh)`
/// for a remote framebuffer of `(fw, fh)`.
pub(super) fn fit_rect(vw: f32, vh: f32, fw: u32, fh: u32) -> Option<FitRect> {
    if vw <= 1. || vh <= 1. || fw == 0 || fh == 0 {
        return None;
    }
    let fw = fw as f32;
    let fh = fh as f32;
    let scale = (vw / fw).min(vh / fh);
    let width = (fw * scale).max(1.);
    let height = (fh * scale).max(1.);
    Some(FitRect {
        x: ((vw - width) * 0.5).max(0.),
        y: ((vh - height) * 0.5).max(0.),
        width,
        height,
    })
}

/// Maps a window pointer `position` onto remote framebuffer pixel coordinates.
pub(super) fn map_pointer(
    bounds: Bounds<Pixels>,
    position: Point<Pixels>,
    fw: u32,
    fh: u32,
) -> Option<(u16, u16)> {
    let vw = f32::from(bounds.size.width);
    let vh = f32::from(bounds.size.height);
    let fit = fit_rect(vw, vh, fw, fh)?;
    let local_x = f32::from(position.x - bounds.origin.x) - fit.x;
    let local_y = f32::from(position.y - bounds.origin.y) - fit.y;
    let rx = ((local_x / fit.width) * (fw as f32))
        .floor()
        .clamp(0., (fw.saturating_sub(1)) as f32) as u16;
    let ry = ((local_y / fit.height) * (fh as f32))
        .floor()
        .clamp(0., (fh.saturating_sub(1)) as f32) as u16;
    Some((rx, ry))
}

pub(super) fn button_bit(button: MouseButton) -> Option<u8> {
    match button {
        MouseButton::Left => Some(1 << 0),
        MouseButton::Middle => Some(1 << 1),
        MouseButton::Right => Some(1 << 2),
        _ => None,
    }
}

/// Tracks depressed modifier/key state so focus loss cleanly releases held keys.
#[derive(Default)]
pub(super) struct InputState {
    pub buttons: u8,
    pub last_pos: (u16, u16),
    pub shift: bool,
    pub control: bool,
    pub alt: bool,
    pub held_keys: Vec<(String, u32)>,
    pub scroll_accum_y: f32,
    pub scroll_accum_x: f32,
}

impl InputState {
    pub fn sync_modifiers(&mut self, m: Modifiers, out: &mut Vec<RfbCommand>) {
        for (held, next, sym) in [
            (&mut self.shift, m.shift, XK_SHIFT_L),
            (&mut self.control, m.control, XK_CONTROL_L),
            (&mut self.alt, m.alt, XK_ALT_L),
        ] {
            if *held != next {
                *held = next;
                out.push(RfbCommand::Key {
                    down: next,
                    keysym: sym,
                });
            }
        }
    }

    pub fn key_down(&mut self, stroke: &Keystroke) -> Vec<RfbCommand> {
        let mut out = Vec::new();
        self.sync_modifiers(stroke.modifiers, &mut out);
        if let Some(sym) = keysym_for_stroke(stroke) {
            if let Some((_, prev)) = self.held_keys.iter_mut().find(|(k, _)| *k == stroke.key) {
                *prev = sym;
            } else {
                self.held_keys.push((stroke.key.clone(), sym));
            }
            out.push(RfbCommand::Key {
                down: true,
                keysym: sym,
            });
        }
        out
    }

    pub fn key_up(&mut self, stroke: &Keystroke) -> Vec<RfbCommand> {
        let mut out = Vec::new();
        let sym = if let Some(idx) = self.held_keys.iter().position(|(k, _)| *k == stroke.key) {
            Some(self.held_keys.remove(idx).1)
        } else {
            keysym_for_stroke(stroke)
        };
        if let Some(sym) = sym {
            out.push(RfbCommand::Key {
                down: false,
                keysym: sym,
            });
        }
        self.sync_modifiers(stroke.modifiers, &mut out);
        out
    }

    pub fn release_all(&mut self) -> Vec<RfbCommand> {
        let mut out = Vec::new();
        for (_, sym) in self.held_keys.drain(..).rev() {
            out.push(RfbCommand::Key {
                down: false,
                keysym: sym,
            });
        }
        self.sync_modifiers(Modifiers::default(), &mut out);
        if self.buttons != 0 {
            self.buttons = 0;
            let (x, y) = self.last_pos;
            out.push(RfbCommand::Pointer { mask: 0, x, y });
        }
        out
    }
}

pub(super) fn keysym_for_stroke(stroke: &Keystroke) -> Option<u32> {
    if let Some(special) = named_keysym(stroke.key.as_str()) {
        return Some(special);
    }
    // Prefer `key_char` for printable characters when Ctrl/Alt are not held so shifted symbols match layout.
    if !stroke.modifiers.control
        && !stroke.modifiers.alt
        && let Some(text) = stroke.key_char.as_deref()
        && let Some(ch) = text.chars().next()
        && text.chars().nth(1).is_none()
        && !ch.is_control()
    {
        return Some(unicode_to_keysym(ch));
    }
    let mut chars = stroke.key.chars();
    let ch = chars.next()?;
    if chars.next().is_some() {
        return None;
    }
    let ch = if stroke.modifiers.shift {
        shifted_ascii(ch)
    } else {
        ch
    };
    Some(unicode_to_keysym(ch))
}

fn named_keysym(key: &str) -> Option<u32> {
    match key {
        "backspace" => Some(0xff08),
        "tab" => Some(0xff09),
        "enter" | "return" => Some(0xff0d),
        "escape" => Some(0xff1b),
        "space" => Some(0x0020),
        "delete" => Some(0xffff),
        "insert" => Some(0xff63),
        "home" => Some(0xff50),
        "left" => Some(0xff51),
        "up" => Some(0xff52),
        "right" => Some(0xff53),
        "down" => Some(0xff54),
        "pageup" => Some(0xff55),
        "pagedown" => Some(0xff56),
        "end" => Some(0xff57),
        "f1" => Some(0xffbe),
        "f2" => Some(0xffbf),
        "f3" => Some(0xffc0),
        "f4" => Some(0xffc1),
        "f5" => Some(0xffc2),
        "f6" => Some(0xffc3),
        "f7" => Some(0xffc4),
        "f8" => Some(0xffc5),
        "f9" => Some(0xffc6),
        "f10" => Some(0xffc7),
        "f11" => Some(0xffc8),
        "f12" => Some(0xffc9),
        _ => None,
    }
}

fn shifted_ascii(ch: char) -> char {
    if ch.is_ascii_lowercase() {
        return ch.to_ascii_uppercase();
    }
    match ch {
        '1' => '!',
        '2' => '@',
        '3' => '#',
        '4' => '$',
        '5' => '%',
        '6' => '^',
        '7' => '&',
        '8' => '*',
        '9' => '(',
        '0' => ')',
        '-' => '_',
        '=' => '+',
        '[' => '{',
        ']' => '}',
        '\\' => '|',
        ';' => ':',
        '\'' => '"',
        ',' => '<',
        '.' => '>',
        '/' => '?',
        '`' => '~',
        other => other,
    }
}

fn unicode_to_keysym(ch: char) -> u32 {
    let code = ch as u32;
    if (0x20..=0x7e).contains(&code) || (0xa0..=0xff).contains(&code) {
        code
    } else {
        0x0100_0000 | code
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{Size, px};

    #[test]
    fn fit_rect_and_pointer_mapping_letterbox_accurately() {
        let bounds = Bounds {
            origin: Point {
                x: px(100.),
                y: px(50.),
            },
            size: Size {
                width: px(1000.),
                height: px(1000.),
            },
        };
        // 1920x1080 inside 1000x1000 -> 1000x562.5 centered at y = 218.75.
        let fit = fit_rect(1000., 1000., 1920, 1080).unwrap();
        assert!((fit.width - 1000.).abs() < 0.01);
        assert!((fit.height - 562.5).abs() < 0.01);
        assert!((fit.y - 218.75).abs() < 0.01);

        assert_eq!(
            map_pointer(
                bounds,
                Point {
                    x: px(600.),
                    y: px(550.)
                },
                1920,
                1080
            ),
            Some((960, 540))
        );
    }

    #[test]
    fn keysyms_and_focus_loss_release_modifiers_and_held_keys() {
        let mut input = InputState::default();
        let down = Keystroke {
            modifiers: Modifiers {
                shift: true,
                ..Default::default()
            },
            key: "a".into(),
            key_char: Some("A".into()),
        };
        let cmds = input.key_down(&down);
        assert_eq!(
            cmds,
            vec![
                RfbCommand::Key {
                    down: true,
                    keysym: XK_SHIFT_L
                },
                RfbCommand::Key {
                    down: true,
                    keysym: u32::from(b'A')
                },
            ]
        );
        input.buttons = 1;
        input.last_pos = (10, 20);
        let released = input.release_all();
        assert_eq!(
            released,
            vec![
                RfbCommand::Key {
                    down: false,
                    keysym: u32::from(b'A')
                },
                RfbCommand::Key {
                    down: false,
                    keysym: XK_SHIFT_L
                },
                RfbCommand::Pointer {
                    mask: 0,
                    x: 10,
                    y: 20
                },
            ]
        );
    }
}
