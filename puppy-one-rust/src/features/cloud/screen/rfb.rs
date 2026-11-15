//! Pure RFB 3.8 client (`RFC 6143` + TigerVNC `ExtendedDesktopSize`) over a
//! ticketed [`ScreenSocket`]. Decodes directly into GPUI's native BGRA8 pixel
//! layout (`[B, G, R, 0xff]`) and strictly isolates the remote clipboard.
use crate::cloud::auth::{ScreenReceiver, ScreenSender, ScreenSocket};
use flate2::{Decompress, FlushDecompress, Status as InflateStatus};
use futures_util::{
    future::{Either, select},
    pin_mut,
};
use std::sync::{Arc, Mutex};

const MAX_DIM: u16 = 8192;
const MAX_PACKET_BYTES: usize = 32 * 1024 * 1024;
const MAX_INFLATED_BYTES: usize = 32 * 1024 * 1024;

const ENC_RAW: i32 = 0;
const ENC_COPY_RECT: i32 = 1;
const ENC_ZLIB: i32 = 6;
const ENC_ZRLE: i32 = 16;
const ENC_DESKTOP_SIZE: i32 = -223;
const ENC_EXTENDED_DESKTOP_SIZE: i32 = -308;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Frame {
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum RfbCommand {
    Pointer { mask: u8, x: u16, y: u16 },
    Key { down: bool, keysym: u32 },
    Resize { width: u16, height: u16 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum RfbError {
    Closed,
    Protocol,
    Auth,
}

#[derive(Clone)]
pub(super) struct FrameSlot {
    latest: Arc<Mutex<Option<Frame>>>,
    wake: async_channel::Sender<()>,
}

impl FrameSlot {
    pub fn pair() -> (Self, async_channel::Receiver<()>) {
        let (wake, rx) = async_channel::bounded(1);
        (
            Self {
                latest: Arc::new(Mutex::new(None)),
                wake,
            },
            rx,
        )
    }

    pub fn publish(&self, frame: Frame) {
        *self.latest.lock().unwrap() = Some(frame);
        let _ = self.wake.try_send(());
    }

    pub fn take(&self) -> Option<Frame> {
        self.latest.lock().unwrap().take()
    }
}

#[derive(Default)]
struct DesktopResizeState {
    screen: Option<(u32, u32)>,
    pending: Option<(u16, u16)>,
}

struct ByteReader {
    rx: ScreenReceiver,
    buf: Vec<u8>,
    pos: usize,
}

impl ByteReader {
    fn new(rx: ScreenReceiver) -> Self {
        Self {
            rx,
            buf: Vec::with_capacity(65536),
            pos: 0,
        }
    }

    async fn ensure(&mut self, needed: usize) -> Result<(), RfbError> {
        if needed > MAX_PACKET_BYTES {
            return Err(RfbError::Protocol);
        }
        while self.buf.len() - self.pos < needed {
            if self.pos > 0 && (self.pos >= 65536 || self.pos * 2 >= self.buf.len()) {
                self.buf.drain(..self.pos);
                self.pos = 0;
            }
            let chunk = self.rx.recv().await.ok_or(RfbError::Closed)?;
            if !chunk.is_empty() {
                self.buf.extend_from_slice(&chunk);
            }
        }
        Ok(())
    }

    async fn read_exact(&mut self, len: usize) -> Result<Vec<u8>, RfbError> {
        self.ensure(len).await?;
        let out = self.buf[self.pos..self.pos + len].to_vec();
        self.pos += len;
        Ok(out)
    }

    async fn skip(&mut self, mut len: usize) -> Result<(), RfbError> {
        if len > MAX_PACKET_BYTES {
            return Err(RfbError::Protocol);
        }
        while len > 0 {
            let buffered = self.buf.len() - self.pos;
            if buffered > 0 {
                let step = buffered.min(len);
                self.pos += step;
                len -= step;
                if self.pos == self.buf.len() {
                    self.buf.clear();
                    self.pos = 0;
                }
            } else {
                self.ensure(1).await?;
            }
        }
        Ok(())
    }

    async fn u8(&mut self) -> Result<u8, RfbError> {
        self.ensure(1).await?;
        let v = self.buf[self.pos];
        self.pos += 1;
        Ok(v)
    }

    async fn u16_be(&mut self) -> Result<u16, RfbError> {
        self.ensure(2).await?;
        let v = u16::from_be_bytes([self.buf[self.pos], self.buf[self.pos + 1]]);
        self.pos += 2;
        Ok(v)
    }

    async fn u32_be(&mut self) -> Result<u32, RfbError> {
        self.ensure(4).await?;
        let b = &self.buf[self.pos..self.pos + 4];
        let v = u32::from_be_bytes([b[0], b[1], b[2], b[3]]);
        self.pos += 4;
        Ok(v)
    }

    async fn i32_be(&mut self) -> Result<i32, RfbError> {
        Ok(self.u32_be().await? as i32)
    }
}

struct Framebuffer {
    width: u16,
    height: u16,
    pixels: Vec<u8>,
}

impl Framebuffer {
    fn new(width: u16, height: u16) -> Result<Self, RfbError> {
        if width == 0 || height == 0 || width > MAX_DIM || height > MAX_DIM {
            return Err(RfbError::Protocol);
        }
        let mut pixels = vec![0u8; usize::from(width) * usize::from(height) * 4];
        for alpha in pixels.iter_mut().skip(3).step_by(4) {
            *alpha = 0xff;
        }
        Ok(Self {
            width,
            height,
            pixels,
        })
    }

    fn check_rect(&self, x: u16, y: u16, w: u16, h: u16) -> Result<(), RfbError> {
        if u32::from(x) + u32::from(w) > u32::from(self.width)
            || u32::from(y) + u32::from(h) > u32::from(self.height)
        {
            Err(RfbError::Protocol)
        } else {
            Ok(())
        }
    }

    fn blit_bgra(&mut self, x: u16, y: u16, w: u16, h: u16, src: &[u8]) -> Result<(), RfbError> {
        self.check_rect(x, y, w, h)?;
        let row_bytes = usize::from(w) * 4;
        if src.len() < row_bytes * usize::from(h) {
            return Err(RfbError::Protocol);
        }
        let stride = usize::from(self.width) * 4;
        for row in 0..usize::from(h) {
            let dst_off = (usize::from(y) + row) * stride + usize::from(x) * 4;
            let src_off = row * row_bytes;
            let dst = &mut self.pixels[dst_off..dst_off + row_bytes];
            dst.copy_from_slice(&src[src_off..src_off + row_bytes]);
            for alpha in dst.iter_mut().skip(3).step_by(4) {
                *alpha = 0xff;
            }
        }
        Ok(())
    }

    fn copy_rect(
        &mut self,
        x: u16,
        y: u16,
        w: u16,
        h: u16,
        sx: u16,
        sy: u16,
    ) -> Result<(), RfbError> {
        self.check_rect(x, y, w, h)?;
        self.check_rect(sx, sy, w, h)?;
        if w == 0 || h == 0 || (x == sx && y == sy) {
            return Ok(());
        }
        let stride = usize::from(self.width) * 4;
        let row_bytes = usize::from(w) * 4;
        if sy < y {
            for row in (0..usize::from(h)).rev() {
                let s = (usize::from(sy) + row) * stride + usize::from(sx) * 4;
                let d = (usize::from(y) + row) * stride + usize::from(x) * 4;
                self.pixels.copy_within(s..s + row_bytes, d);
            }
        } else {
            for row in 0..usize::from(h) {
                let s = (usize::from(sy) + row) * stride + usize::from(sx) * 4;
                let d = (usize::from(y) + row) * stride + usize::from(x) * 4;
                self.pixels.copy_within(s..s + row_bytes, d);
            }
        }
        Ok(())
    }

    #[inline]
    fn put_pixel(&mut self, x: u16, y: u16, bgra: [u8; 4]) {
        let idx = (usize::from(y) * usize::from(self.width) + usize::from(x)) * 4;
        self.pixels[idx..idx + 4].copy_from_slice(&bgra);
    }

    fn fill_rect(&mut self, x: u16, y: u16, w: u16, h: u16, bgra: [u8; 4]) {
        let stride = usize::from(self.width) * 4;
        for row in 0..usize::from(h) {
            let start = (usize::from(y) + row) * stride + usize::from(x) * 4;
            for px in self.pixels[start..start + usize::from(w) * 4].chunks_exact_mut(4) {
                px.copy_from_slice(&bgra);
            }
        }
    }

    fn snapshot(&self) -> Frame {
        Frame {
            width: u32::from(self.width),
            height: u32::from(self.height),
            bgra: self.pixels.clone(),
        }
    }
}

pub(super) async fn run_session(
    socket: ScreenSocket,
    commands: async_channel::Receiver<RfbCommand>,
    on_connected: impl FnOnce(),
    frames: FrameSlot,
) -> Result<(), RfbError> {
    let (tx, rx) = socket.into_split();
    let mut reader = ByteReader::new(rx);
    let mut fb = negotiate(&tx, &mut reader).await?;
    on_connected();

    let resize_state = Arc::new(Mutex::new(DesktopResizeState::default()));
    let read_fut = read_loop(tx.clone(), reader, &mut fb, frames, resize_state.clone());
    let send_fut = command_loop(tx, commands, resize_state);
    pin_mut!(read_fut, send_fut);
    match select(read_fut, send_fut).await {
        Either::Left((res, _)) => res,
        Either::Right((res, _)) => res,
    }
}

async fn negotiate(tx: &ScreenSender, reader: &mut ByteReader) -> Result<Framebuffer, RfbError> {
    let greeting = reader.read_exact(12).await?;
    if &greeting[..4] != b"RFB " || greeting[11] != b'\n' {
        return Err(RfbError::Protocol);
    }
    let minor = std::str::from_utf8(&greeting[8..11])
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or(RfbError::Protocol)?;
    let (version_reply, minor_ver): (&[u8; 12], u16) = if minor >= 8 {
        (b"RFB 003.008\n", 8)
    } else if minor == 7 {
        (b"RFB 003.007\n", 7)
    } else if minor >= 3 {
        (b"RFB 003.003\n", 3)
    } else {
        return Err(RfbError::Protocol);
    };
    tx.send(version_reply.to_vec())
        .await
        .map_err(|_| RfbError::Closed)?;

    if minor_ver >= 7 {
        let count = usize::from(reader.u8().await?);
        if count == 0 {
            let reason_len = reader.u32_be().await? as usize;
            reader.skip(reason_len).await?;
            return Err(RfbError::Auth);
        }
        let types = reader.read_exact(count).await?;
        if !types.contains(&1) {
            return Err(RfbError::Auth);
        }
        tx.send(vec![1]).await.map_err(|_| RfbError::Closed)?;
        if minor_ver == 8 && reader.u32_be().await? != 0 {
            let reason_len = reader.u32_be().await? as usize;
            reader.skip(reason_len).await?;
            return Err(RfbError::Auth);
        }
    } else if reader.u32_be().await? != 1 {
        return Err(RfbError::Auth);
    }

    // ClientInit: shared = 1 so reconnects never evict the desktop session.
    tx.send(vec![1]).await.map_err(|_| RfbError::Closed)?;
    let width = reader.u16_be().await?;
    let height = reader.u16_be().await?;
    reader.skip(16).await?;
    let name_len = reader.u32_be().await? as usize;
    if name_len > 65536 {
        return Err(RfbError::Protocol);
    }
    reader.skip(name_len).await?;
    let fb = Framebuffer::new(width, height)?;

    // SetPixelFormat (32bpp, depth 24, LE, R<<16 | G<<8 | B -> wire [B, G, R, _]),
    // SetEncodings, and the initial non-incremental FramebufferUpdateRequest.
    let mut init_batch = Vec::with_capacity(64);
    init_batch.extend_from_slice(&[
        0, 0, 0, 0, // SetPixelFormat + pad
        32, 24, 0, 1, // 32bpp, 24-bit depth, little-endian, true-colour
        0, 255, 0, 255, 0, 255, // r/g/b max = 255
        16, 8, 0, // shifts: R=16, G=8, B=0 -> LE bytes [B, G, R, X]
        0, 0, 0, // pad
    ]);
    let encodings = [
        ENC_COPY_RECT,
        ENC_ZRLE,
        ENC_ZLIB,
        ENC_RAW,
        ENC_EXTENDED_DESKTOP_SIZE,
        ENC_DESKTOP_SIZE,
    ];
    init_batch.extend_from_slice(&[2, 0]);
    init_batch.extend_from_slice(&(encodings.len() as u16).to_be_bytes());
    for enc in encodings {
        init_batch.extend_from_slice(&enc.to_be_bytes());
    }
    append_fb_request(&mut init_batch, false, width, height);
    tx.send(init_batch).await.map_err(|_| RfbError::Closed)?;
    Ok(fb)
}

fn append_fb_request(out: &mut Vec<u8>, incremental: bool, width: u16, height: u16) {
    out.push(3);
    out.push(u8::from(incremental));
    out.extend_from_slice(&0u16.to_be_bytes());
    out.extend_from_slice(&0u16.to_be_bytes());
    out.extend_from_slice(&width.to_be_bytes());
    out.extend_from_slice(&height.to_be_bytes());
}

pub(super) fn encode_set_desktop_size(width: u16, height: u16, id: u32, flags: u32) -> Vec<u8> {
    let w = (width & !1).clamp(320, 4096);
    let h = (height & !1).clamp(240, 4096);
    let mut msg = Vec::with_capacity(24);
    msg.extend_from_slice(&[251, 0]);
    msg.extend_from_slice(&w.to_be_bytes());
    msg.extend_from_slice(&h.to_be_bytes());
    msg.extend_from_slice(&[1, 0]);
    msg.extend_from_slice(&id.to_be_bytes());
    msg.extend_from_slice(&0u16.to_be_bytes());
    msg.extend_from_slice(&0u16.to_be_bytes());
    msg.extend_from_slice(&w.to_be_bytes());
    msg.extend_from_slice(&h.to_be_bytes());
    msg.extend_from_slice(&flags.to_be_bytes());
    msg
}

async fn command_loop(
    tx: ScreenSender,
    commands: async_channel::Receiver<RfbCommand>,
    resize_state: Arc<Mutex<DesktopResizeState>>,
) -> Result<(), RfbError> {
    while let Ok(cmd) = commands.recv().await {
        let packet = match cmd {
            RfbCommand::Pointer { mask, x, y } => {
                let [xh, xl] = x.to_be_bytes();
                let [yh, yl] = y.to_be_bytes();
                Some(vec![5, mask, xh, xl, yh, yl])
            }
            RfbCommand::Key { down, keysym } => {
                let [k0, k1, k2, k3] = keysym.to_be_bytes();
                Some(vec![4, u8::from(down), 0, 0, k0, k1, k2, k3])
            }
            RfbCommand::Resize { width, height } => {
                let screen = {
                    let mut state = resize_state.lock().unwrap();
                    if let Some(screen) = state.screen {
                        Some(screen)
                    } else {
                        state.pending = Some((width, height));
                        None
                    }
                };
                screen.map(|(id, flags)| encode_set_desktop_size(width, height, id, flags))
            }
        };
        if let Some(bytes) = packet {
            tx.send(bytes).await.map_err(|_| RfbError::Closed)?;
        }
    }
    Ok(())
}

async fn read_loop(
    tx: ScreenSender,
    mut reader: ByteReader,
    fb: &mut Framebuffer,
    frames: FrameSlot,
    resize_state: Arc<Mutex<DesktopResizeState>>,
) -> Result<(), RfbError> {
    let mut zlib = Decompress::new(true);
    let mut zrle = Decompress::new(true);
    let mut inflate_buf = Vec::new();
    loop {
        match reader.u8().await? {
            0 => {
                let _ = reader.u8().await?;
                let rects = reader.u16_be().await?;
                let mut painted = false;
                let mut resized = false;
                let mut deferred_resize: Option<Vec<u8>> = None;
                for _ in 0..rects {
                    let x = reader.u16_be().await?;
                    let y = reader.u16_be().await?;
                    let w = reader.u16_be().await?;
                    let h = reader.u16_be().await?;
                    let enc = reader.i32_be().await?;
                    match enc {
                        ENC_RAW => {
                            fb.check_rect(x, y, w, h)?;
                            let raw = reader
                                .read_exact(usize::from(w) * usize::from(h) * 4)
                                .await?;
                            fb.blit_bgra(x, y, w, h, &raw)?;
                            painted = true;
                        }
                        ENC_COPY_RECT => {
                            let sx = reader.u16_be().await?;
                            let sy = reader.u16_be().await?;
                            fb.copy_rect(x, y, w, h, sx, sy)?;
                            painted = true;
                        }
                        ENC_ZLIB => {
                            fb.check_rect(x, y, w, h)?;
                            let len = reader.u32_be().await? as usize;
                            let compressed = reader.read_exact(len).await?;
                            let expected = usize::from(w) * usize::from(h) * 4;
                            inflate_stream(
                                &mut zlib,
                                &compressed,
                                Some(expected),
                                &mut inflate_buf,
                            )?;
                            fb.blit_bgra(x, y, w, h, &inflate_buf)?;
                            painted = true;
                        }
                        ENC_ZRLE => {
                            fb.check_rect(x, y, w, h)?;
                            let len = reader.u32_be().await? as usize;
                            let compressed = reader.read_exact(len).await?;
                            inflate_stream(&mut zrle, &compressed, None, &mut inflate_buf)?;
                            decode_zrle(fb, x, y, w, h, &inflate_buf)?;
                            painted = true;
                        }
                        ENC_DESKTOP_SIZE => {
                            if (w, h) != (fb.width, fb.height) {
                                *fb = Framebuffer::new(w, h)?;
                                resized = true;
                            }
                        }
                        ENC_EXTENDED_DESKTOP_SIZE => {
                            let screens = usize::from(reader.u8().await?);
                            reader.skip(3).await?;
                            let mut first = None;
                            for i in 0..screens {
                                let id = reader.u32_be().await?;
                                reader.skip(8).await?;
                                let flags = reader.u32_be().await?;
                                if i == 0 {
                                    first = Some((id, flags));
                                }
                            }
                            let (id, flags) = first.unwrap_or((0, 0));
                            {
                                let mut state = resize_state.lock().unwrap();
                                state.screen = Some((id, flags));
                                if let Some((pw, ph)) = state.pending.take() {
                                    deferred_resize =
                                        Some(encode_set_desktop_size(pw, ph, id, flags));
                                }
                            }
                            // x == 1 && y != 0 indicates a rejected client resize; keep current dimensions.
                            let rejected = x == 1 && y != 0;
                            if !rejected && (w, h) != (fb.width, fb.height) {
                                *fb = Framebuffer::new(w, h)?;
                                resized = true;
                            }
                        }
                        _ => return Err(RfbError::Protocol),
                    }
                }
                if painted {
                    frames.publish(fb.snapshot());
                }
                if let Some(msg) = deferred_resize {
                    tx.send(msg).await.map_err(|_| RfbError::Closed)?;
                }
                let mut req = Vec::with_capacity(10);
                append_fb_request(&mut req, !resized, fb.width, fb.height);
                tx.send(req).await.map_err(|_| RfbError::Closed)?;
            }
            1 => {
                // SetColourMapEntries (unused in true-colour mode).
                let _ = reader.u8().await?;
                let _ = reader.u16_be().await?;
                let count = usize::from(reader.u16_be().await?);
                reader.skip(count.saturating_mul(6)).await?;
            }
            2 => {} // Bell.
            3 => {
                // ServerCutText: intentionally discarded so remote clipboards never leak locally.
                reader.skip(3).await?;
                let len = reader.u32_be().await? as usize;
                reader.skip(len).await?;
            }
            _ => return Err(RfbError::Protocol),
        }
    }
}

fn inflate_stream(
    stream: &mut Decompress,
    compressed: &[u8],
    exact: Option<usize>,
    out: &mut Vec<u8>,
) -> Result<(), RfbError> {
    out.clear();
    if let Some(cap) = exact {
        if cap > MAX_INFLATED_BYTES {
            return Err(RfbError::Protocol);
        }
        out.reserve(cap);
    }
    let mut in_pos = 0;
    let mut scratch = [0u8; 16384];
    loop {
        let before_in = stream.total_in();
        let before_out = stream.total_out();
        let status = stream
            .decompress(&compressed[in_pos..], &mut scratch, FlushDecompress::Sync)
            .map_err(|_| RfbError::Protocol)?;
        let consumed = (stream.total_in() - before_in) as usize;
        let produced = (stream.total_out() - before_out) as usize;
        in_pos += consumed;
        if out.len().saturating_add(produced) > MAX_INFLATED_BYTES {
            return Err(RfbError::Protocol);
        }
        out.extend_from_slice(&scratch[..produced]);
        if matches!(status, InflateStatus::StreamEnd)
            || (in_pos >= compressed.len() && produced == 0)
        {
            break;
        }
        if consumed == 0 && produced == 0 {
            return Err(RfbError::Protocol);
        }
    }
    if let Some(expected) = exact
        && out.len() != expected
    {
        return Err(RfbError::Protocol);
    }
    Ok(())
}

struct SliceCursor<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> SliceCursor<'a> {
    fn u8(&mut self) -> Result<u8, RfbError> {
        let b = *self.data.get(self.pos).ok_or(RfbError::Protocol)?;
        self.pos += 1;
        Ok(b)
    }

    fn cpixel(&mut self) -> Result<[u8; 4], RfbError> {
        let s = self
            .data
            .get(self.pos..self.pos + 3)
            .ok_or(RfbError::Protocol)?;
        self.pos += 3;
        Ok([s[0], s[1], s[2], 0xff])
    }

    fn rle_len(&mut self, max: usize) -> Result<usize, RfbError> {
        let mut len = 1usize;
        loop {
            let b = usize::from(self.u8()?);
            len = len.saturating_add(b);
            if len > max {
                return Err(RfbError::Protocol);
            }
            if b != 255 {
                return Ok(len);
            }
        }
    }
}

fn decode_zrle(
    fb: &mut Framebuffer,
    rx: u16,
    ry: u16,
    rw: u16,
    rh: u16,
    data: &[u8],
) -> Result<(), RfbError> {
    let mut cur = SliceCursor { data, pos: 0 };
    let mut ty = 0u16;
    while ty < rh {
        let th = (rh - ty).min(64);
        let mut tx = 0u16;
        while tx < rw {
            let tw = (rw - tx).min(64);
            let sub = cur.u8()?;
            match sub {
                0 => {
                    for py in 0..th {
                        for px in 0..tw {
                            fb.put_pixel(rx + tx + px, ry + ty + py, cur.cpixel()?);
                        }
                    }
                }
                1 => fb.fill_rect(rx + tx, ry + ty, tw, th, cur.cpixel()?),
                2..=16 => {
                    let size = usize::from(sub);
                    let mut pal = [[0u8; 4]; 16];
                    for entry in &mut pal[..size] {
                        *entry = cur.cpixel()?;
                    }
                    let bits: u8 = match size {
                        2 => 1,
                        3 | 4 => 2,
                        _ => 4,
                    };
                    let mask = (1u8 << bits) - 1;
                    for py in 0..th {
                        let mut byte = 0u8;
                        let mut shift = 0u8;
                        for px in 0..tw {
                            if shift == 0 {
                                byte = cur.u8()?;
                                shift = 8;
                            }
                            shift -= bits;
                            let idx = usize::from((byte >> shift) & mask);
                            if idx >= size {
                                return Err(RfbError::Protocol);
                            }
                            fb.put_pixel(rx + tx + px, ry + ty + py, pal[idx]);
                        }
                    }
                }
                128 => {
                    let total = usize::from(tw) * usize::from(th);
                    let mut i = 0;
                    while i < total {
                        let color = cur.cpixel()?;
                        let run = cur.rle_len(total - i)?;
                        for _ in 0..run {
                            let px = (i % usize::from(tw)) as u16;
                            let py = (i / usize::from(tw)) as u16;
                            fb.put_pixel(rx + tx + px, ry + ty + py, color);
                            i += 1;
                        }
                    }
                }
                130..=255 => {
                    let size = usize::from(sub - 128);
                    let mut pal = [[0u8; 4]; 127];
                    for entry in &mut pal[..size] {
                        *entry = cur.cpixel()?;
                    }
                    let total = usize::from(tw) * usize::from(th);
                    let mut i = 0;
                    while i < total {
                        let b = cur.u8()?;
                        let idx = usize::from(b & 0x7f);
                        if idx >= size {
                            return Err(RfbError::Protocol);
                        }
                        let run = if b & 0x80 == 0 {
                            1
                        } else {
                            cur.rle_len(total - i)?
                        };
                        let color = pal[idx];
                        for _ in 0..run {
                            let px = (i % usize::from(tw)) as u16;
                            let py = (i / usize::from(tw)) as u16;
                            fb.put_pixel(rx + tx + px, ry + ty + py, color);
                            i += 1;
                        }
                    }
                }
                _ => return Err(RfbError::Protocol),
            }
            tx += tw;
        }
        ty += th;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{Compress, FlushCompress};

    fn deflate_sync(comp: &mut Compress, raw: &[u8]) -> Vec<u8> {
        let mut out = vec![0u8; raw.len() + 64];
        let before = comp.total_out();
        comp.compress(raw, &mut out, FlushCompress::Sync).unwrap();
        out.truncate((comp.total_out() - before) as usize);
        out
    }

    fn block_on<F: std::future::Future>(fut: F) -> F::Output {
        struct ThreadWaker(std::thread::Thread);
        impl std::task::Wake for ThreadWaker {
            fn wake(self: Arc<Self>) {
                self.0.unpark();
            }
        }
        let waker = std::task::Waker::from(Arc::new(ThreadWaker(std::thread::current())));
        let mut cx = std::task::Context::from_waker(&waker);
        let mut fut = std::pin::pin!(fut);
        loop {
            match fut.as_mut().poll(&mut cx) {
                std::task::Poll::Ready(out) => return out,
                std::task::Poll::Pending => std::thread::park(),
            }
        }
    }

    #[test]
    fn rfb_session_handles_fragmented_frames_zrle_copyrect_resize_and_input() {
        let (client_sock, server_sock) = ScreenSocket::pair();
        let (cmd_tx, cmd_rx) = async_channel::unbounded();
        let (slot, wake_rx) = FrameSlot::pair();

        let server = std::thread::spawn(move || {
            block_on(async move {
                // Fragmented greeting across 2 WebSocket frames.
                server_sock.send(b"RFB 00".to_vec()).await.unwrap();
                server_sock.send(b"3.008\n".to_vec()).await.unwrap();
                assert_eq!(server_sock.recv().await.unwrap(), b"RFB 003.008\n");

                // Security types: [1 (None)] -> SecurityResult 0.
                server_sock.send(vec![1, 1]).await.unwrap();
                assert_eq!(server_sock.recv().await.unwrap(), vec![1]);
                server_sock.send(0u32.to_be_bytes().to_vec()).await.unwrap();

                // ClientInit (shared = 1) -> ServerInit (4x2 desktop named "po").
                assert_eq!(server_sock.recv().await.unwrap(), vec![1]);
                let mut init = Vec::new();
                init.extend_from_slice(&4u16.to_be_bytes());
                init.extend_from_slice(&2u16.to_be_bytes());
                init.extend_from_slice(&[32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0]);
                init.extend_from_slice(&2u32.to_be_bytes());
                init.extend_from_slice(b"po");
                server_sock.send(init).await.unwrap();

                // Receive SetPixelFormat + SetEncodings + initial FramebufferUpdateRequest.
                let setup = server_sock.recv().await.unwrap();
                assert_eq!(setup[0], 0);

                // Send ServerCutText (must be ignored), then ExtendedDesktopSize + ZRLE solid 2x2 + CopyRect 2x2.
                let mut cut = vec![3, 0, 0, 0];
                cut.extend_from_slice(&6u32.to_be_bytes());
                cut.extend_from_slice(b"secret");
                server_sock.send(cut).await.unwrap();

                let mut zrle_comp = Compress::new(flate2::Compression::default(), true);
                let zrle_tile = deflate_sync(&mut zrle_comp, &[1, 0x11, 0x22, 0x33]);

                let mut update = vec![0, 0];
                update.extend_from_slice(&3u16.to_be_bytes());
                // Rect 1: ExtendedDesktopSize (4x2, screen id = 7, flags = 0).
                update.extend_from_slice(&0u16.to_be_bytes());
                update.extend_from_slice(&0u16.to_be_bytes());
                update.extend_from_slice(&4u16.to_be_bytes());
                update.extend_from_slice(&2u16.to_be_bytes());
                update.extend_from_slice(&ENC_EXTENDED_DESKTOP_SIZE.to_be_bytes());
                update.extend_from_slice(&[1, 0, 0, 0]);
                update.extend_from_slice(&7u32.to_be_bytes());
                update.extend_from_slice(&[0; 8]);
                update.extend_from_slice(&0u32.to_be_bytes());
                // Rect 2: ZRLE solid at (0, 0, 2, 2) with CPIXEL [0x11, 0x22, 0x33].
                update.extend_from_slice(&0u16.to_be_bytes());
                update.extend_from_slice(&0u16.to_be_bytes());
                update.extend_from_slice(&2u16.to_be_bytes());
                update.extend_from_slice(&2u16.to_be_bytes());
                update.extend_from_slice(&ENC_ZRLE.to_be_bytes());
                update.extend_from_slice(&(zrle_tile.len() as u32).to_be_bytes());
                update.extend_from_slice(&zrle_tile);
                // Rect 3: CopyRect from (0, 0) to (2, 0, 2, 2).
                update.extend_from_slice(&2u16.to_be_bytes());
                update.extend_from_slice(&0u16.to_be_bytes());
                update.extend_from_slice(&2u16.to_be_bytes());
                update.extend_from_slice(&2u16.to_be_bytes());
                update.extend_from_slice(&ENC_COPY_RECT.to_be_bytes());
                update.extend_from_slice(&0u16.to_be_bytes());
                update.extend_from_slice(&0u16.to_be_bytes());
                server_sock.send(update).await.unwrap();

                // Expect incremental FramebufferUpdateRequest, then client resize + pointer + key.
                let next_req = server_sock.recv().await.unwrap();
                assert_eq!(&next_req[..2], &[3, 1]);
                let resize_pkt = server_sock.recv().await.unwrap();
                assert_eq!(resize_pkt[0], 251);
                let ptr_pkt = server_sock.recv().await.unwrap();
                assert_eq!(ptr_pkt, vec![5, 1, 0, 3, 0, 1]);
                let key_pkt = server_sock.recv().await.unwrap();
                assert_eq!(key_pkt, vec![4, 1, 0, 0, 0, 0, 0, b'a']);
            })
        });

        block_on(async move {
            let connected = Arc::new(Mutex::new(false));
            let flag = connected.clone();
            let session_task = std::thread::spawn(move || {
                block_on(run_session(
                    client_sock,
                    cmd_rx,
                    move || *flag.lock().unwrap() = true,
                    slot.clone(),
                ))
            });

            wake_rx.recv().await.unwrap();
            assert!(*connected.lock().unwrap());
            cmd_tx
                .send(RfbCommand::Resize {
                    width: 1281,
                    height: 721,
                })
                .await
                .unwrap();
            cmd_tx
                .send(RfbCommand::Pointer {
                    mask: 1,
                    x: 3,
                    y: 1,
                })
                .await
                .unwrap();
            cmd_tx
                .send(RfbCommand::Key {
                    down: true,
                    keysym: u32::from(b'a'),
                })
                .await
                .unwrap();
            server.join().unwrap();
            cmd_tx.close();
            let _ = session_task.join().unwrap();
        });
    }

    #[test]
    fn copy_rect_handles_vertical_and_horizontal_overlap() {
        let mut fb = Framebuffer::new(4, 3).unwrap();
        fb.put_pixel(0, 0, [1, 2, 3, 0xff]);
        fb.put_pixel(1, 0, [4, 5, 6, 0xff]);
        fb.put_pixel(0, 1, [7, 8, 9, 0xff]);
        fb.put_pixel(1, 1, [10, 11, 12, 0xff]);
        // Overlapping downward + rightward shift: (0,0,2,2) -> (1,1,2,2).
        fb.copy_rect(1, 1, 2, 2, 0, 0).unwrap();
        let idx_1_1 = (4 + 1) * 4;
        assert_eq!(&fb.pixels[idx_1_1..idx_1_1 + 4], &[1, 2, 3, 0xff]);
        assert_eq!(
            &fb.pixels[(2 * 4 + 2) * 4..(2 * 4 + 2) * 4 + 4],
            &[10, 11, 12, 0xff]
        );
    }
}
