use super::*;
use core::prelude::v1::test;
use flate2::{Compression, write::GzEncoder};

fn make_tar_gz(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut gz = GzEncoder::new(Vec::new(), Compression::fast());
    {
        let mut tar = tar::Builder::new(&mut gz);
        for (path, data) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            tar.append_data(&mut header, path, *data).unwrap();
        }
        tar.finish().unwrap();
    }
    gz.finish().unwrap()
}

#[test]
fn pinned_excalidraw_spec_parses_digests_and_fonts() {
    let spec = excalidraw_spec();
    assert!(!spec.version.is_empty());
    assert_eq!(spec.script_sha256.len(), 64);
    assert_eq!(spec.style_sha256.len(), 64);
    assert!(spec.fonts.len() >= 200);
    for family in ["Assistant/", "Excalifont/", "Virgil/", "Xiaolai/"] {
        assert!(spec.fonts.keys().any(|k| k.starts_with(family)), "{family}");
    }
}

#[test]
fn tampered_scripts_are_rejected_and_missing_root_returns_none() {
    let dir = tempfile::tempdir().unwrap();
    assert!(load_excalidraw_from(dir.path()).is_none());

    let bad_js = make_tar_gz(&[
        ("excalidraw.js", b"tampered"),
        ("excalidraw.css", b"tampered"),
    ]);
    let err = install_excalidraw_bytes(dir.path(), &bad_js).unwrap_err();
    assert!(err.contains("digest mismatch"), "{err}");
    assert!(load_excalidraw_from(dir.path()).is_none());

    // Tampered on-disk script after manual placement is also refused.
    let spec = excalidraw_spec();
    let manual = dir.path().join(EXCALIDRAW_PACK_ID).join(&spec.version);
    std::fs::create_dir_all(manual.join("fonts")).unwrap();
    std::fs::write(manual.join("excalidraw.js"), b"bad").unwrap();
    std::fs::write(manual.join("excalidraw.css"), b"bad").unwrap();
    assert!(load_excalidraw_from(dir.path()).is_none());
}

fn fixture() -> (ExcalidrawSpec, Vec<(&'static str, &'static [u8])>) {
    let files: Vec<(&str, &[u8])> = vec![
        ("excalidraw.js", b"pinned script"),
        ("excalidraw.css", b"pinned style"),
        ("fonts/Test/font.woff2", b"pinned font"),
    ];
    let spec = ExcalidrawSpec {
        version: "test-version".into(),
        script_sha256: sha256_hex(files[0].1),
        style_sha256: sha256_hex(files[1].1),
        fonts: BTreeMap::from([("Test/font.woff2".into(), sha256_hex(files[2].1))]),
    };
    (spec, files)
}

#[test]
fn deterministic_valid_archives_install_and_every_font_is_verified_again_on_load() {
    let dir = tempfile::tempdir().unwrap();
    let (spec, files) = fixture();
    let installed = install_with_spec(dir.path(), &make_tar_gz(&files), &spec).unwrap();
    assert_eq!(&*installed.script, files[0].1);
    assert_eq!(&*installed.style, files[1].1);
    assert_eq!(
        std::fs::read(installed.dir.join(files[2].0)).unwrap(),
        files[2].1
    );
    assert!(load_with_spec(dir.path(), &spec).is_some());
    std::fs::write(installed.dir.join(files[2].0), b"tampered font").unwrap();
    assert!(
        load_with_spec(dir.path(), &spec).is_none(),
        "a verified script cannot admit an unverified font"
    );
}

#[test]
fn duplicate_or_unlisted_archive_files_are_refused_without_replacing_the_installed_pack() {
    let dir = tempfile::tempdir().unwrap();
    let (spec, files) = fixture();
    let installed = install_with_spec(dir.path(), &make_tar_gz(&files), &spec).unwrap();
    for extra in [
        ("excalidraw.js", b"pinned script".as_slice()),
        ("extra.js", b"unlisted script".as_slice()),
    ] {
        let mut bad = files.clone();
        bad.push(extra);
        assert!(
            install_with_spec(dir.path(), &make_tar_gz(&bad), &spec).is_err(),
            "accepted {}",
            extra.0
        );
        assert_eq!(
            &*load_with_spec(dir.path(), &spec).unwrap().script,
            files[0].1
        );
        assert!(!installed.dir.join("extra.js").exists());
    }
}

fn raw_archive(path: &str, kind: tar::EntryType) -> Vec<u8> {
    let mut gz = GzEncoder::new(Vec::new(), Compression::fast());
    {
        let mut tar = tar::Builder::new(&mut gz);
        let mut header = tar::Header::new_gnu();
        header.as_mut_bytes()[..path.len()].copy_from_slice(path.as_bytes());
        header.set_entry_type(kind);
        header.set_mode(0o644);
        header.set_size(0);
        if kind.is_symlink() || kind.is_hard_link() {
            header.set_link_name("outside").unwrap();
        }
        header.set_cksum();
        tar.append(&header, std::io::empty()).unwrap();
        tar.finish().unwrap();
    }
    gz.finish().unwrap()
}

#[test]
fn actual_traversal_absolute_link_and_special_entries_never_escape_staging() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("packs");
    let (spec, _) = fixture();
    let outside = dir.path().join("outside");
    std::fs::write(&outside, b"untouched").unwrap();
    for (name, kind) in [
        ("../outside", tar::EntryType::Regular),
        (outside.to_str().unwrap(), tar::EntryType::Regular),
        ("excalidraw.js", tar::EntryType::Symlink),
        ("excalidraw.js", tar::EntryType::Link),
        ("pipe", tar::EntryType::Fifo),
    ] {
        assert!(
            install_with_spec(&root, &raw_archive(name, kind), &spec).is_err(),
            "{name}"
        );
        assert_eq!(std::fs::read(&outside).unwrap(), b"untouched");
        assert!(!root.join(EXCALIDRAW_PACK_ID).join(&spec.version).exists());
        assert!(!std::fs::read_dir(&root).unwrap().any(|e| {
            e.unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".staging-")
        }));
    }
}

#[test]
fn missing_or_changed_pinned_files_keep_the_previous_installation_and_remove_staging() {
    let dir = tempfile::tempdir().unwrap();
    let (spec, files) = fixture();
    install_with_spec(dir.path(), &make_tar_gz(&files), &spec).unwrap();
    for index in 0..files.len() {
        for missing in [false, true] {
            let mut bad = files.clone();
            if missing {
                bad.remove(index);
            } else {
                bad[index].1 = b"tampered";
            }
            assert!(install_with_spec(dir.path(), &make_tar_gz(&bad), &spec).is_err());
            assert_eq!(
                &*load_with_spec(dir.path(), &spec).unwrap().script,
                files[0].1
            );
            assert!(!std::fs::read_dir(dir.path()).unwrap().any(|e| {
                e.unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".staging-")
            }));
        }
    }
}

#[test]
fn chunked_downloads_stop_at_the_byte_budget_without_waiting_for_eof() {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::mpsc,
    };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = url::Url::parse(&format!("http://{}/pack", listener.local_addr().unwrap())).unwrap();
    let (release, wait) = mpsc::channel();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut request = Vec::new();
        let mut byte = [0; 1];
        while !request.ends_with(b"\r\n\r\n") {
            stream.read_exact(&mut byte).unwrap();
            request.push(byte[0]);
        }
        stream.write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n10001\r\n").unwrap();
        stream.write_all(&vec![b'x'; 65_537]).unwrap();
        stream.write_all(b"\r\n").unwrap();
        // No terminating chunk or EOF until the client has answered.
        let _ = wait.recv_timeout(Duration::from_secs(5));
    });
    let result = download_with_budget(&url, 65_536, Duration::from_secs(2));
    let _ = release.send(());
    server.join().unwrap();
    let error = result.unwrap_err();
    assert!(
        error.contains("limit"),
        "must reject bytes rather than wait for the request timeout: {error}"
    );
}

#[cfg(unix)]
#[test]
fn installed_assets_and_font_directories_cannot_be_replaced_with_symlinks() {
    use std::os::unix::fs::symlink;
    let dir = tempfile::tempdir().unwrap();
    let (spec, files) = fixture();
    let installed = install_with_spec(dir.path(), &make_tar_gz(&files), &spec).unwrap();
    let font = installed.dir.join(files[2].0);
    let outside = dir.path().join("outside-font");
    std::fs::write(&outside, files[2].1).unwrap();
    std::fs::remove_file(&font).unwrap();
    symlink(&outside, &font).unwrap();
    assert!(load_with_spec(dir.path(), &spec).is_none());
    std::fs::remove_file(&font).unwrap();
    std::fs::write(&font, files[2].1).unwrap();
    let original = installed.dir.join("fonts");
    let moved = dir.path().join("outside-fonts");
    std::fs::rename(&original, &moved).unwrap();
    symlink(&moved, &original).unwrap();
    assert!(load_with_spec(dir.path(), &spec).is_none());
}

#[test]
fn local_archive_reads_stop_at_the_budget_and_preserve_io_failures() {
    use std::io::{Cursor, Read};
    let bytes = vec![b'x'; 128];
    let mut cursor = Cursor::new(&bytes);
    assert!(read_archive(&mut cursor, 64).unwrap_err().contains("limit"));
    assert_eq!(cursor.position(), 65);
    assert_eq!(
        read_archive(Cursor::new(&bytes[..64]), 64).unwrap(),
        bytes[..64]
    );
    struct Broken;
    impl Read for Broken {
        fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("owned read failed"))
        }
    }
    assert!(
        read_archive(Broken, 64)
            .unwrap_err()
            .contains("owned read failed")
    );
}

#[test]
fn repeated_and_concurrent_installation_reuses_one_complete_version() {
    let dir = tempfile::tempdir().unwrap();
    let (spec, files) = fixture();
    let archive = make_tar_gz(&files);
    let installed = install_with_spec(dir.path(), &archive, &spec).unwrap();
    #[cfg(unix)]
    let inode = {
        use std::os::unix::fs::MetadataExt;
        std::fs::metadata(&installed.dir).unwrap().ino()
    };
    let barrier = std::sync::Barrier::new(4);
    std::thread::scope(|scope| {
        let handles: Vec<_> = (0..4)
            .map(|_| {
                scope.spawn(|| {
                    barrier.wait();
                    install_with_spec(dir.path(), &archive, &spec).unwrap()
                })
            })
            .collect();
        for worker in handles {
            assert_eq!(worker.join().unwrap().dir, installed.dir);
        }
    });
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        assert_eq!(std::fs::metadata(&installed.dir).unwrap().ino(), inode);
    }
    let names: Vec<_> = std::fs::read_dir(dir.path().join(EXCALIDRAW_PACK_ID))
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(names.len(), 2);
    assert!(names.iter().any(|n| n == ".install.lock"));
    assert!(names.iter().any(|n| n == spec.version.as_str()));
}

#[test]
fn failed_publication_leaves_an_existing_file_untouched_and_cleans_staging() {
    let dir = tempfile::tempdir().unwrap();
    let (spec, files) = fixture();
    let parent = dir.path().join(EXCALIDRAW_PACK_ID);
    std::fs::create_dir(&parent).unwrap();
    let dest = parent.join(&spec.version);
    std::fs::write(&dest, b"existing owner").unwrap();
    assert!(install_with_spec(dir.path(), &make_tar_gz(&files), &spec).is_err());
    assert_eq!(std::fs::read(dest).unwrap(), b"existing owner");
    assert_eq!(std::fs::read_dir(parent).unwrap().count(), 2);
}

#[test]
#[ignore = "requires the pinned built pack; tools/verify-viewer-pack.py builds and executes this test"]
fn the_actual_pinned_pack_installs_all_sdk_fonts_without_network_fallback() {
    let spec = excalidraw_spec();
    let archive = std::env::var_os("PUPPYONE_TEST_EXCALIDRAW_ARCHIVE")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../artifacts/viewer-packs")
                .join(format!("{EXCALIDRAW_PACK_ID}-{}.tar.gz", spec.version))
        });
    let bytes = read_archive_file(&archive)
        .expect("the required built pack is missing or exceeds its budget");
    let temp = tempfile::tempdir().unwrap();
    let installed = install_excalidraw_bytes(temp.path(), &bytes).unwrap();
    assert_eq!(sha256_hex(&installed.script), spec.script_sha256);
    assert_eq!(sha256_hex(&installed.style), spec.style_sha256);
    assert_eq!(spec.fonts.len(), 234);
    for (font, digest) in &spec.fonts {
        assert_eq!(
            sha256_hex(&std::fs::read(installed.dir.join("fonts").join(font)).unwrap()),
            *digest,
            "{font}"
        );
    }
    let js = std::str::from_utf8(&installed.script).unwrap();
    assert!(!js.contains("esm.sh"));
    assert!(js.contains("()=>{this.callbacks.delete("));
    assert!(!js.contains("if(!this.callbacks.has("));
    for marker in [
        "__assets__/excalidraw/",
        "matchMedia?.(\"(pointer: coarse)\")",
        "getElementById(\"desktop-overlay-root\")??document.body",
    ] {
        assert!(js.contains(marker), "{marker}");
    }
    assert!(
        std::str::from_utf8(&installed.style)
            .unwrap()
            .contains("url(excalidraw/fonts/Assistant/Assistant-Regular.woff2)")
    );
    assert!(load_excalidraw_from(temp.path()).is_some());
    assert_eq!(
        std::fs::read(installed.dir.join("LICENSE")).unwrap(),
        include_bytes!("../../../licenses/excalidraw/LICENSE")
    );
}

#[test]
fn cache_reuses_verified_bundles_but_rejects_a_changed_font() {
    let dir = tempfile::tempdir().unwrap();
    let (spec, files) = fixture();
    let pack = install_with_spec(dir.path(), &make_tar_gz(&files), &spec).unwrap();
    let cache = Mutex::new(None);
    let first = load_cached(dir.path(), &spec, &cache).unwrap();
    let second = load_cached(dir.path(), &spec, &cache).unwrap();
    assert!(Arc::ptr_eq(&first.script, &second.script));
    std::fs::write(pack.dir.join(files[2].0), b"changed after caching").unwrap();
    assert!(load_cached(dir.path(), &spec, &cache).is_none());
    install_with_spec(dir.path(), &make_tar_gz(&files), &spec).unwrap();
    assert!(load_cached(dir.path(), &spec, &cache).is_some());
}

#[test]
fn download_headers_errors_and_redirects_preserve_the_admission_boundary() {
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };
    fn exchange(response: &'static [u8]) -> Result<Vec<u8>, String> {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url =
            url::Url::parse(&format!("http://{}/pack", listener.local_addr().unwrap())).unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0; 1];
            while !request.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            stream.write_all(response).unwrap();
        });
        let result = download_with_budget(&url, 5, Duration::from_secs(2));
        server.join().unwrap();
        result
    }
    assert_eq!(
        exchange(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nab\0cd")
            .unwrap(),
        b"ab\0cd"
    );
    assert_eq!(exchange(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n2\r\nab\r\n3\r\n\0cd\r\n0\r\n\r\n").unwrap(),b"ab\0cd");
    assert!(
        exchange(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\n")
            .unwrap_err()
            .contains("limit")
    );
    assert!(
        exchange(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .unwrap_err()
            .contains("404")
    );
    assert!(exchange(b"HTTP/1.1 302 Found\r\nLocation: http://192.0.2.1/untrusted\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap_err().contains("redirect"));
}
