use super::*;
use image::{DynamicImage, ImageFormat};
use std::io::Cursor;

fn encoded(image: DynamicImage, format: ImageFormat) -> Vec<u8> {
    let mut output = Cursor::new(Vec::new());
    image.write_to(&mut output, format).unwrap();
    output.into_inner()
}

fn rgba(width: u32, height: u32) -> DynamicImage {
    image::RgbaImage::from_pixel(width, height, image::Rgba([220, 40, 20, 128])).into()
}

fn assert_pixel_limit(bytes: &[u8], budget: u64) {
    assert!(
        matches!(
            decode_fallback_pixels(bytes, budget),
            Err(image::ImageError::Limits(_))
        ),
        "expanded pixels must be refused before decoding (budget {budget})"
    );
}

#[test]
fn enabled_fallback_codecs_apply_the_pixel_budget_before_shrinking() {
    for format in [
        ImageFormat::Png,
        ImageFormat::Jpeg,
        ImageFormat::WebP,
        ImageFormat::Bmp,
        ImageFormat::Tiff,
    ] {
        let source = if format == ImageFormat::Jpeg {
            DynamicImage::ImageRgb8(rgba(64, 32).into_rgb8())
        } else {
            rgba(64, 32)
        };
        let bytes = encoded(source, format);
        assert_pixel_limit(&bytes, 64 * 32 * 4 - 1);
        let decoded = decode_fallback_pixels(&bytes, 64 * 32 * 4).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (64, 32));
        let pixel = decoded.into_rgba8().get_pixel(0, 0).0;
        assert!(pixel[0].abs_diff(220) <= 3 && pixel[2].abs_diff(20) <= 3);
        assert_eq!(
            pixel[3],
            if format == ImageFormat::Jpeg {
                255
            } else {
                128
            }
        );
    }
}

#[test]
fn oversized_headers_are_rejected_before_invalid_pixel_data_is_decoded() {
    // Keep the tiny image's real IDAT, but describe a much larger raster. A
    // decoder that proceeds to pixels would report corrupt/truncated data.
    let mut bytes = encoded(rgba(1, 1), ImageFormat::Png);
    bytes[16..20].copy_from_slice(&8192u32.to_be_bytes());
    bytes[20..24].copy_from_slice(&8192u32.to_be_bytes());
    let mut crc = u32::MAX;
    for byte in &bytes[12..29] {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb88320u32 & 0u32.wrapping_sub(crc & 1));
        }
    }
    bytes[29..33].copy_from_slice(&(!crc).to_be_bytes());
    assert!(bytes.len() < 1024);
    assert_pixel_limit(&bytes, MAX_DECODE_BYTES as u64);
}

#[test]
fn corrupt_and_empty_inputs_never_produce_a_fabricated_frame() {
    let valid = encoded(rgba(64, 32), ImageFormat::Png);
    for bytes in [&[][..], &b"not an image"[..], &valid[..valid.len() / 2]] {
        assert!(decode_fallback_pixels(bytes, MAX_DECODE_BYTES as u64).is_err());
        assert!(
            decode_with_image_crate(
                ImageInput::Bytes {
                    mime: Some("image/png"),
                    bytes
                },
                u64::MAX,
                64
            )
            .is_err()
        );
    }
}

#[test]
#[cfg(target_os = "macos")]
fn system_fallback_resamples_its_output_and_preserves_the_source() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("source.png");
    let original = encoded(rgba(4200, 4), ImageFormat::Png);
    std::fs::write(&path, &original).unwrap();
    let png = sips_to_png(&path).unwrap();
    let decoded = decode_fallback_pixels(&png, MAX_DECODE_BYTES as u64).unwrap();
    assert_eq!(decoded.width(), 4096);
    assert!((1..=4).contains(&decoded.height()));
    assert_eq!(std::fs::read(&path).unwrap(), original);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[test]
fn grayscale_and_sixteen_bit_inputs_account_for_native_and_rgba_expansion() {
    let gray = encoded(
        image::GrayImage::from_pixel(64, 32, image::Luma([120])).into(),
        ImageFormat::Png,
    );
    assert_pixel_limit(&gray, 64 * 32 * 4 - 1);
    assert_eq!(
        decode_fallback_pixels(&gray, 64 * 32 * 4)
            .unwrap()
            .into_rgba8()
            .get_pixel(0, 0)
            .0,
        [120, 120, 120, 255]
    );

    let wide = encoded(
        image::ImageBuffer::<image::Rgba<u16>, _>::from_pixel(
            64,
            32,
            image::Rgba([65535, 0, 0, 32768]),
        )
        .into(),
        ImageFormat::Png,
    );
    assert_pixel_limit(&wide, 64 * 32 * 8 - 1);
    let decoded = decode_fallback_pixels(&wide, 64 * 32 * 8).unwrap();
    assert_eq!(decoded.color(), image::ColorType::Rgba16);
    assert_eq!(decoded.into_rgba8().get_pixel(0, 0).0, [255, 0, 0, 128]);
}

#[test]
fn fallback_checks_the_source_budget_for_both_file_and_bytes() {
    let bytes = encoded(rgba(64, 32), ImageFormat::Png);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("wrong-extension.bin");
    std::fs::write(&path, &bytes).unwrap();
    for input in [
        ImageInput::Bytes {
            mime: Some("image/jpeg"),
            bytes: &bytes,
        },
        ImageInput::File(&path),
    ] {
        assert_eq!(
            decode_with_image_crate(input, bytes.len() as u64 - 1, 64),
            Err(DecodeError::BudgetExceeded {
                size: bytes.len() as u64,
                limit: bytes.len() as u64 - 1
            })
        );
        let decoded = decode_with_image_crate(input, bytes.len() as u64, 64).unwrap();
        assert_eq!((decoded.natural_width, decoded.natural_height), (64, 32));
        assert_eq!(decoded.frames[0].bgra[..4], [10, 20, 110, 128]);
    }
}

#[test]
fn fallback_preserves_natural_dimensions_and_resizes_without_upscaling() {
    let bytes = encoded(rgba(384, 128), ImageFormat::Png);
    for (requested, expected) in [(0, (64, 21)), (96, (96, 32)), (8192, (384, 128))] {
        let decoded = decode_with_image_crate(
            ImageInput::Bytes {
                mime: None,
                bytes: &bytes,
            },
            bytes.len() as u64,
            requested,
        )
        .unwrap();
        assert_eq!((decoded.natural_width, decoded.natural_height), (384, 128));
        assert_eq!(decoded.frames.len(), 1);
        let frame = &decoded.frames[0];
        assert_eq!((frame.width, frame.height), expected);
        assert_eq!(decoded.decoded_max_px, expected.0);
        assert_eq!(
            frame.bgra.len(),
            expected.0 as usize * expected.1 as usize * 4
        );
        assert!(
            frame
                .bgra
                .chunks_exact(4)
                .all(|pixel| pixel == [10, 20, 110, 128])
        );
    }
}
