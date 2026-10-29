//! Help → Feedback delivery (`electron/main/ipc/feedback-ipc.mjs`) and the
//! screenshot preparation the dialog does before it (`prepareFeedbackScreenshot`
//! in `DesktopHelpLauncher.tsx`). A trimmed message (at most 2000 characters),
//! a contact email and an optional PNG, JPEG or WebP image of at most 3 MiB
//! whose bytes match its type go to the public feedback form as multipart
//! form data, with the app version, locale and platform; never workspace or
//! account data.
use std::time::Duration;

pub const DEFAULT_ENDPOINT: &str = "https://formspree.io/f/mlgqvydy";
pub const MAX_MESSAGE: usize = 2_000;
pub const MAX_EMAIL: usize = 254;
const MAX_LOCALE: usize = 80;
pub const MAX_SCREENSHOT: usize = 3 * 1024 * 1024;
/// The largest source image the dialog accepts before compressing it.
pub const MAX_SOURCE_SCREENSHOT: u64 = 20 * 1024 * 1024;
/// Compression scales the longer edge down to this.
const MAX_EDGE: u32 = 1_920;
const TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mime {
    Png,
    Jpeg,
    Webp,
}
impl Mime {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Webp => "image/webp",
        }
    }
    fn filename(self) -> &'static str {
        match self {
            Self::Png => "feedback-screenshot.png",
            Self::Jpeg => "feedback-screenshot.jpg",
            Self::Webp => "feedback-screenshot.webp",
        }
    }
    /// The type the bytes declare by their signature.
    pub fn sniff(bytes: &[u8]) -> Option<Self> {
        [Self::Png, Self::Jpeg, Self::Webp]
            .into_iter()
            .find(|mime| signature_matches(bytes, *mime))
    }
}

/// `hasExpectedImageSignature`.
fn signature_matches(bytes: &[u8], mime: Mime) -> bool {
    match mime {
        Mime::Png => bytes.starts_with(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Mime::Jpeg => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        Mime::Webp => bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP",
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Screenshot {
    pub bytes: Vec<u8>,
    pub mime: Mime,
}

/// Why a screenshot cannot be attached (`ScreenshotPreparationError`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PrepareError {
    Unsupported,
    TooLarge,
}

/// `prepareFeedbackScreenshot`: a PNG, JPEG or WebP image of at most 20 MiB;
/// above 3 MiB it is scaled to a 1920px edge and re-encoded (lossless WebP,
/// else JPEG at 80% when that is still too large). The product re-encodes
/// as lossy WebP at 80%, which this image codec cannot write.
pub fn prepare(bytes: Vec<u8>) -> Result<Screenshot, PrepareError> {
    let mime = Mime::sniff(&bytes).ok_or(PrepareError::Unsupported)?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_SOURCE_SCREENSHOT {
        return Err(PrepareError::TooLarge);
    }
    if bytes.len() <= MAX_SCREENSHOT {
        return Ok(Screenshot { bytes, mime });
    }
    compress(&bytes)
}

/// Clipboard images arrive in whatever format the pasteboard holds; the
/// product's renderer receives pasted images as PNG, so other formats are
/// transcoded before preparation.
pub fn prepare_pasted(bytes: Vec<u8>) -> Result<Screenshot, PrepareError> {
    if Mime::sniff(&bytes).is_some() {
        return prepare(bytes);
    }
    let image = image::load_from_memory(&bytes).map_err(|_| PrepareError::Unsupported)?;
    let mut png = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|_| PrepareError::Unsupported)?;
    prepare(png)
}

fn compress(bytes: &[u8]) -> Result<Screenshot, PrepareError> {
    let image = image::load_from_memory(bytes).map_err(|_| PrepareError::TooLarge)?;
    let (w, h) = (image.width().max(1), image.height().max(1));
    let scale = (MAX_EDGE as f32 / w as f32)
        .min(MAX_EDGE as f32 / h as f32)
        .min(1.);
    let image = if scale < 1. {
        image.resize_exact(
            ((w as f32 * scale).round() as u32).max(1),
            ((h as f32 * scale).round() as u32).max(1),
            image::imageops::FilterType::Triangle,
        )
    } else {
        image
    };
    let mut webp = Vec::new();
    let rgba = image.to_rgba8();
    if image::codecs::webp::WebPEncoder::new_lossless(&mut webp)
        .encode(
            &rgba,
            rgba.width(),
            rgba.height(),
            image::ExtendedColorType::Rgba8,
        )
        .is_ok()
        && !webp.is_empty()
        && webp.len() <= MAX_SCREENSHOT
    {
        return Ok(Screenshot {
            bytes: webp,
            mime: Mime::Webp,
        });
    }
    let mut jpeg = Vec::new();
    let rgb = image.to_rgb8();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 80)
        .encode(
            &rgb,
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|_| PrepareError::TooLarge)?;
    if jpeg.len() > MAX_SCREENSHOT {
        return Err(PrepareError::TooLarge);
    }
    Ok(Screenshot {
        bytes: jpeg,
        mime: Mime::Jpeg,
    })
}

/// `isValidFeedbackEmail` / `parseContactEmail`: `^[^\s@]+@[^\s@]+\.[^\s@]+$`.
pub fn valid_email(value: &str) -> bool {
    // JavaScript string lengths count UTF-16 code units.
    if value.is_empty() || value.encode_utf16().count() > MAX_EMAIL {
        return false;
    }
    let ok = |part: &str| !part.is_empty() && !part.chars().any(|c| c == '@' || c.is_whitespace());
    let Some((local, domain)) = value.split_once('@') else {
        return false;
    };
    // The domain needs a dot with something on both sides; the regex
    // backtracks to any such dot.
    ok(local)
        && !domain.contains('@')
        && domain
            .char_indices()
            .filter(|(_, c)| *c == '.')
            .any(|(i, _)| ok(&domain[..i]) && ok(&domain[i + 1..]))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Request {
    pub message: String,
    pub email: String,
    pub locale: String,
    pub screenshot: Option<Screenshot>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    EmptyMessage,
    MessageTooLong,
    InvalidEmail,
    ScreenshotSize,
    ScreenshotSignature,
    Endpoint,
    /// The service could not be reached.
    Unavailable,
    /// The service answered with an error.
    Rejected,
}

/// The validated form: `(content type, body)`.
pub fn form(
    request: &Request,
    app_version: &str,
    platform: &str,
    timestamp: &str,
    boundary: &str,
) -> Result<(String, Vec<u8>), Error> {
    let message = request.message.trim();
    if message.encode_utf16().count() > MAX_MESSAGE {
        return Err(Error::MessageTooLong);
    }
    if message.is_empty() {
        return Err(Error::EmptyMessage);
    }
    let email = request.email.trim();
    if !valid_email(email) {
        return Err(Error::InvalidEmail);
    }
    if let Some(shot) = &request.screenshot {
        if shot.bytes.is_empty() || shot.bytes.len() > MAX_SCREENSHOT {
            return Err(Error::ScreenshotSize);
        }
        if !signature_matches(&shot.bytes, shot.mime) {
            return Err(Error::ScreenshotSignature);
        }
    }
    let context = |value: &str| value.trim().chars().take(80).collect::<String>();
    let version = context(app_version);
    let subject = format!(
        "PuppyOne Desktop Feedback · v{}",
        if version.is_empty() {
            "unknown"
        } else {
            &version
        }
    );
    let locale: String = request.locale.trim().chars().take(MAX_LOCALE).collect();
    let mut body = Vec::new();
    let mut field = |name: &str, value: &str| {
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
            )
            .as_bytes(),
        );
    };
    field("message", message);
    field("email", email);
    field("appVersion", &version);
    field("locale", &locale);
    field("platform", &context(platform));
    field("source", "PuppyOne Desktop");
    field("subject", &subject);
    field("timestamp", timestamp);
    field("_gotcha", "");
    if let Some(shot) = &request.screenshot {
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"attachment\"; filename=\"{}\"\r\nContent-Type: {}\r\n\r\n",
                shot.mime.filename(),
                shot.mime.as_str()
            )
            .as_bytes(),
        );
        body.extend_from_slice(&shot.bytes);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    Ok((format!("multipart/form-data; boundary={boundary}"), body))
}

/// `requireFeedbackEndpoint`: HTTPS, or HTTP on the loopback host, without
/// credentials; `PUPPYONE_FEEDBACK_ENDPOINT` replaces the public form.
pub fn endpoint(value: Option<&str>) -> Result<url::Url, Error> {
    let url = url::Url::parse(value.unwrap_or(DEFAULT_ENDPOINT)).map_err(|_| Error::Endpoint)?;
    if (url.scheme() != "https" && !(url.scheme() == "http" && loopback(&url)))
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(Error::Endpoint);
    }
    Ok(url)
}

/// Sends the feedback; blocks for at most 15 seconds.
pub fn submit(request: &Request, app_version: &str) -> Result<(), Error> {
    let configured = std::env::var("PUPPYONE_FEEDBACK_ENDPOINT").ok();
    send_to(
        endpoint(configured.as_deref().filter(|v| !v.is_empty()))?,
        request,
        app_version,
    )
}

fn loopback(url: &url::Url) -> bool {
    matches!(url.host_str(), Some("127.0.0.1" | "localhost"))
}

fn send_to(url: url::Url, request: &Request, app_version: &str) -> Result<(), Error> {
    let boundary = format!("puppyone-feedback-{}", uuid::Uuid::new_v4().simple());
    let timestamp = crate::platform::telemetry::store::iso(chrono::Utc::now());
    let platform = crate::platform::build_identity::node_platform();
    let (content_type, body) = form(request, app_version, platform, &timestamp, &boundary)?;
    let version = app_version.trim();
    let agent = format!(
        "puppyone-desktop/{}",
        if version.is_empty() {
            "unknown"
        } else {
            version
        }
    );
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| Error::Unavailable)?;
    let status = runtime.block_on(async {
        let mut client = reqwest::Client::builder().timeout(TIMEOUT);
        // Like Chromium, a loopback endpoint never goes through a proxy.
        if loopback(&url) {
            client = client.no_proxy();
        }
        let client = client.build().map_err(|_| Error::Unavailable)?;
        let response = client
            .post(url)
            .header("accept", "application/json")
            .header("user-agent", agent)
            .header("content-type", content_type)
            .body(body)
            .send()
            .await
            .map_err(|_| Error::Unavailable)?;
        Ok::<_, Error>(response.status())
    })?;
    if !status.is_success() {
        return Err(Error::Rejected);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    const PNG: &[u8] = &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];

    fn request(message: &str, email: &str) -> Request {
        Request {
            message: message.into(),
            email: email.into(),
            locale: "en-US".into(),
            screenshot: None,
        }
    }
    fn text(body: &[u8]) -> String {
        String::from_utf8_lossy(body).into_owned()
    }

    #[test]
    fn a_trimmed_message_goes_out_without_workspace_or_account_data() {
        let (content_type, body) = form(
            &request("  The sidebar flickers.  ", " person@example.com "),
            " 0.4.0 ",
            "darwin",
            "2026-10-30T00:00:00.000Z",
            "B",
        )
        .unwrap();
        assert_eq!(content_type, "multipart/form-data; boundary=B");
        let body = text(&body);
        let fields: Vec<(&str, &str)> = body
            .split("--B")
            .filter_map(|part| {
                let (head, value) = part.split_once("\r\n\r\n")?;
                let name = head.split("name=\"").nth(1)?.split('"').next()?;
                Some((name, value.trim_end_matches("\r\n")))
            })
            .collect();
        assert_eq!(
            fields,
            [
                ("message", "The sidebar flickers."),
                ("email", "person@example.com"),
                ("appVersion", "0.4.0"),
                ("locale", "en-US"),
                ("platform", "darwin"),
                ("source", "PuppyOne Desktop"),
                ("subject", "PuppyOne Desktop Feedback · v0.4.0"),
                ("timestamp", "2026-10-30T00:00:00.000Z"),
                ("_gotcha", ""),
            ]
        );
        assert!(body.ends_with("--B--\r\n"));
        for word in ["path", "workspace", "account", "token"] {
            assert!(!body.to_lowercase().contains(word), "{word}");
        }
    }

    /// One loopback exchange: the raw request it received, answered with
    /// `status`.
    fn serve_once(status: &'static str) -> (url::Url, std::thread::JoinHandle<String>) {
        use std::io::{BufRead as _, BufReader, Read as _, Write as _};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url =
            url::Url::parse(&format!("http://{}/f/test", listener.local_addr().unwrap())).unwrap();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream);
            let mut head = String::new();
            let mut length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap();
                }
                head.push_str(&line);
                if line == "\r\n" {
                    break;
                }
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            let mut stream = reader.into_inner();
            write!(
                stream,
                "HTTP/1.1 {status}\r\ncontent-length: 2\r\nconnection: close\r\n\r\n{{}}"
            )
            .unwrap();
            head + &text(&body)
        });
        (url, server)
    }

    #[test]
    fn feedback_posts_one_multipart_form_and_only_a_success_status_counts() {
        let mut with_shot = request("The sidebar flickers.", "person@example.com");
        with_shot.screenshot = Some(Screenshot {
            bytes: PNG.to_vec(),
            mime: Mime::Png,
        });
        let (url, server) = serve_once("200 OK");
        assert_eq!(send_to(url, &with_shot, "0.4.0"), Ok(()));
        let received = server.join().unwrap();
        let lower = received.to_ascii_lowercase();
        assert!(
            received.starts_with("POST /f/test HTTP/1.1\r\n"),
            "{received}"
        );
        assert!(lower.contains("\r\naccept: application/json\r\n"));
        assert!(lower.contains("\r\nuser-agent: puppyone-desktop/0.4.0\r\n"));
        assert!(
            lower.contains("\r\ncontent-type: multipart/form-data; boundary=puppyone-feedback-")
        );
        assert!(received.contains("name=\"message\"\r\n\r\nThe sidebar flickers.\r\n"));
        assert!(received.contains("name=\"email\"\r\n\r\nperson@example.com\r\n"));
        assert!(received.contains("filename=\"feedback-screenshot.png\""));

        // An error status is a rejection; a closed port is unreachable.
        let (url, server) = serve_once("500 Internal Server Error");
        assert_eq!(
            send_to(url, &request("hi", "a@b.co"), "0.4.0"),
            Err(Error::Rejected)
        );
        server.join().unwrap();
        let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = url::Url::parse(&format!("http://{}/f", closed.local_addr().unwrap())).unwrap();
        drop(closed);
        assert_eq!(
            send_to(url, &request("hi", "a@b.co"), "0.4.0"),
            Err(Error::Unavailable)
        );
    }

    #[test]
    fn empty_oversized_and_unreachable_feedback_fail_before_the_network() {
        let at = "2026-10-30T00:00:00.000Z";
        let fail = |r: &Request| form(r, "0.4.0", "darwin", at, "B").unwrap_err();
        assert_eq!(fail(&request("   ", "a@b.co")), Error::EmptyMessage);
        assert_eq!(
            fail(&request(&"x".repeat(2001), "a@b.co")),
            Error::MessageTooLong
        );
        assert!(
            form(
                &request(&"界".repeat(2000), "a@b.co"),
                "0.4.0",
                "darwin",
                at,
                "B"
            )
            .is_ok()
        );
        // An emoji is two UTF-16 units, as the textarea's maxLength counts.
        assert_eq!(
            fail(&request(&"🐶".repeat(1001), "a@b.co")),
            Error::MessageTooLong
        );
        assert_eq!(fail(&request("hi", "not-an-email")), Error::InvalidEmail);
        assert_eq!(fail(&request("hi", "a b@c.d")), Error::InvalidEmail);
        assert_eq!(
            fail(&request("hi", &format!("{}@b.co", "a".repeat(250)))),
            Error::InvalidEmail
        );
        assert!(endpoint(None).is_ok());
        assert!(endpoint(Some("http://127.0.0.1:9000/f")).is_ok());
        assert_eq!(endpoint(Some("http://example.com/f")), Err(Error::Endpoint));
        assert_eq!(
            endpoint(Some("https://u:p@example.com/f")),
            Err(Error::Endpoint)
        );
    }

    #[test]
    fn an_attachment_must_match_its_type_and_size() {
        let mut r = request("See attached", "a@b.co");
        r.screenshot = Some(Screenshot {
            bytes: PNG.to_vec(),
            mime: Mime::Png,
        });
        let (_, body) = form(&r, "", "darwin", "t", "B").unwrap();
        let body = text(&body);
        assert!(body.contains(
            "name=\"attachment\"; filename=\"feedback-screenshot.png\"\r\nContent-Type: image/png"
        ));
        assert!(body.contains("PuppyOne Desktop Feedback · vunknown"));
        r.screenshot = Some(Screenshot {
            bytes: PNG.to_vec(),
            mime: Mime::Jpeg,
        });
        assert_eq!(
            form(&r, "", "darwin", "t", "B").unwrap_err(),
            Error::ScreenshotSignature
        );
        r.screenshot = Some(Screenshot {
            bytes: vec![0xff; MAX_SCREENSHOT + 1],
            mime: Mime::Jpeg,
        });
        assert_eq!(
            form(&r, "", "darwin", "t", "B").unwrap_err(),
            Error::ScreenshotSize
        );
    }

    #[test]
    fn emails_follow_the_product_pattern() {
        for good in [
            "a@b.co",
            "first.last+tag@sub.example.org",
            "a@b.c.d",
            "名@例子.中国",
        ] {
            assert!(valid_email(good), "{good}");
        }
        for bad in [
            "", "a@b", "@b.co", "a@.co", "a@b.", "a@@b.co", "a@b@c.co", "a@b .co",
        ] {
            assert!(!valid_email(bad), "{bad}");
        }
    }

    #[test]
    fn screenshots_are_sniffed_and_large_ones_are_compressed() {
        assert_eq!(Mime::sniff(PNG), Some(Mime::Png));
        assert_eq!(Mime::sniff(&[0xff, 0xd8, 0xff, 0]), Some(Mime::Jpeg));
        assert_eq!(Mime::sniff(b"RIFF\0\0\0\0WEBPVP8 "), Some(Mime::Webp));
        assert_eq!(
            prepare(b"GIF89a....".to_vec()),
            Err(PrepareError::Unsupported)
        );
        assert_eq!(prepare(PNG.to_vec()).unwrap().mime, Mime::Png);
        // A noisy 2400×1600 PNG over 3 MiB: scaled to a 1920px edge and
        // re-encoded under the limit.
        let mut seed = 7u32;
        let noisy = image::RgbaImage::from_fn(2400, 1600, |_, _| {
            seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
            let [a, b, c, _] = seed.to_le_bytes();
            image::Rgba([a, b, c, 255])
        });
        let mut png = Vec::new();
        noisy
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        assert!(png.len() > MAX_SCREENSHOT);
        let prepared = prepare(png).unwrap();
        assert!(prepared.bytes.len() <= MAX_SCREENSHOT);
        assert!(signature_matches(&prepared.bytes, prepared.mime));
        let decoded = image::load_from_memory(&prepared.bytes).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (1920, 1280));
        // Pasted TIFF (or BMP) becomes a PNG.
        let mut bmp = Vec::new();
        image::RgbaImage::from_pixel(4, 4, image::Rgba([1, 2, 3, 255]))
            .write_to(&mut std::io::Cursor::new(&mut bmp), image::ImageFormat::Bmp)
            .unwrap();
        assert_eq!(prepare_pasted(bmp).unwrap().mime, Mime::Png);
    }
}
