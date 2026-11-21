//! The production detail owner, worker result channel, and rendered controls.
use super::*;
use core::prelude::v1::test;
use std::sync::Mutex;

type Reply = Result<Vec<FileDiff>, String>;
struct Pending {
    reply: Option<mpsc::Sender<Reply>>,
}
impl Pending {
    fn finish(mut self, result: Reply) {
        self.reply.take().unwrap().send(result).unwrap();
    }
}
impl Drop for Pending {
    fn drop(&mut self) {
        if let Some(reply) = self.reply.take() {
            let _ = reply.send(Err("fixture released".into()));
        }
    }
}
struct Fixture<'a> {
    view: Entity<SourceControl>,
    cx: &'a mut VisualTestContext,
    requests: mpsc::Receiver<Pending>,
    reader: DetailReader,
    _root: tempfile::TempDir,
}
impl<'a> Fixture<'a> {
    fn new(cx: &'a mut TestAppContext) -> Self {
        cx.executor().allow_parking();
        cx.update(gpui_kit::init);
        let root = tempfile::tempdir().unwrap();
        let (send, requests) = mpsc::channel();
        let (view, cx) = cx.add_window_view(SourceControl::new);
        cx.simulate_resize(size(px(450.), px(650.)));
        view.update(cx, |s, _| {
            s.root = Some(root.path().into());
            s.snapshot = Some(Snapshot::default());
        });
        Self {
            view,
            cx,
            requests,
            reader: Arc::new(move |_, _| {
                let (reply, result) = mpsc::channel();
                send.send(Pending { reply: Some(reply) }).unwrap();
                result
                    .recv_timeout(Duration::from_secs(10))
                    .expect("bounded diff reader")
            }),
            _root: root,
        }
    }
    fn open(&mut self, path: &str) -> Arc<AtomicBool> {
        let reader = self.reader.clone();
        self.view.update(self.cx, |s, cx| {
            s.open_detail(
                DetailKind::Working(Selection {
                    change: Change {
                        path: path.into(),
                        original: None,
                        index: ' ',
                        worktree: 'M',
                    },
                    scope: Scope::Unstaged,
                }),
                move |root, cancel| reader(root, cancel),
                cx,
            );
            s.detail_cancel.clone()
        })
    }
    fn request(&mut self) -> Pending {
        self.requests
            .recv_timeout(Duration::from_secs(5))
            .expect("physical diff read")
    }
    fn settle(&mut self, predicate: impl Fn(&SourceControl) -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            self.cx.run_until_parked();
            if self.view.read_with(self.cx, |s, _| predicate(s)) {
                break;
            }
            assert!(Instant::now() < deadline, "diff publication did not settle");
            std::thread::sleep(Duration::from_millis(1));
        }
        self.draw();
    }
    fn draw(&mut self) {
        self.cx.run_until_parked();
        self.cx.update(|w, cx| {
            w.refresh();
            w.draw(cx).clear(cx);
        });
    }
    fn click_retry(&mut self) {
        self.draw();
        let button = self
            .cx
            .debug_bounds("git-diff-retry")
            .expect("failed diff exposes Retry");
        self.cx
            .simulate_click(button.center(), Modifiers::default());
        self.draw();
    }
    fn retry(&mut self) {
        self.click_retry();
        self.view.read_with(self.cx, |s, _| {
            assert!(s.detail.as_ref().unwrap().files.is_none())
        });
        assert!(
            self.cx.debug_bounds("git-diff-retry").is_none(),
            "no duplicate Retry while loading"
        );
    }
}
fn model(path: &str, text: &str) -> Vec<FileDiff> {
    git_diff::parse_patch(&format!(
        "diff --git a/{path} b/{path}\n@@ -1 +1 @@\n-old\n+{text}\n"
    ))
}

#[gpui::test]
fn superseded_diff_readers_are_cancelled_and_never_publish_their_models(cx: &mut TestAppContext) {
    let mut f = Fixture::new(cx);
    // Observe every accepted model, not only the eventual last one.
    let seen = Arc::new(Mutex::new(Vec::<String>::new()));
    let seen_by_observer = seen.clone();
    let subscription = f.cx.update(|_, cx| {
        cx.observe(&f.view, move |s, cx| {
            if let Some(Ok(files)) = s.read(cx).detail.as_ref().and_then(|d| d.files.as_ref()) {
                seen_by_observer.lock().unwrap().extend(
                    files
                        .iter()
                        .flat_map(|f| f.lines.iter().map(|l| l.text.clone())),
                );
            }
        })
    });
    let old_cancel = f.open("old.txt");
    let old = f.request();
    let new_cancel = f.open("new.txt");
    let new = f.request();
    assert!(old_cancel.load(Ordering::Relaxed));
    assert!(!new_cancel.load(Ordering::Relaxed));
    old.finish(Ok(model("old.txt", "OLD MODEL")));
    // Receive the actual old worker's result before yielding to the event
    // loop, then run it through the production poller. This proves that it
    // cannot appear even transiently while the new worker is still blocked.
    f.view.update_in(f.cx, |s, window, cx| {
        let result = s.rx.recv_timeout(Duration::from_secs(5)).unwrap();
        s.tx.send(result).unwrap();
        s.poll(window, cx);
        assert!(s.detail.as_ref().unwrap().files.is_none());
    });
    new.finish(Ok(model("new.txt", "NEW MODEL")));
    f.settle(|s| matches!(s.detail.as_ref().and_then(|d| d.files.as_ref()), Some(Ok(files)) if files[0].path == "new.txt"));
    assert!(seen.lock().unwrap().iter().any(|line| line == "NEW MODEL"));
    assert!(!seen.lock().unwrap().iter().any(|line| line == "OLD MODEL"));
    drop(subscription);
}

#[gpui::test]
fn failed_diff_reads_offer_one_retry_and_recover_through_the_same_loader(cx: &mut TestAppContext) {
    let mut f = Fixture::new(cx);
    f.open("report.docx");
    f.view.read_with(f.cx, |s, _| {
        assert!(s.detail.as_ref().unwrap().files.is_none())
    });
    f.request().finish(Err("Malformed package".into()));
    f.settle(|s| matches!(s.detail.as_ref().and_then(|d| d.files.as_ref()), Some(Err(e)) if e == "Malformed package"));
    f.retry();
    f.request().finish(Ok(model("report.docx", "RECOVERED")));
    f.settle(|s| {
        matches!(
            s.detail.as_ref().and_then(|d| d.files.as_ref()),
            Some(Ok(_))
        )
    });
    assert!(f.cx.debug_bounds("git-diff-retry").is_none());
    assert!(matches!(
        f.requests.try_recv(),
        Err(mpsc::TryRecvError::Empty)
    ));
}

#[gpui::test]
fn a_word_parser_failure_can_retry_without_reopening_the_file(cx: &mut TestAppContext) {
    let mut f = Fixture::new(cx);
    f.open("report.docx");
    let mut word = model("report.docx", "");
    word[0].binary = true;
    word[0].lines.clear();
    word[0].redline = Some(Err("Malformed package".into()));
    f.request().finish(Ok(word));
    f.settle(|s| {
        matches!(
            s.detail.as_ref().and_then(|d| d.files.as_ref()),
            Some(Ok(_))
        )
    });
    f.retry();
    f.request().finish(Ok(model("report.docx", "RECOVERED")));
    f.settle(|s| matches!(s.detail.as_ref().and_then(|d| d.files.as_ref()), Some(Ok(files)) if files[0].redline.is_none()));
    assert!(f.cx.debug_bounds("git-diff-retry").is_none());
}

#[gpui::test]
fn repairing_a_real_word_file_recovers_via_the_rendered_retry(cx: &mut TestAppContext) {
    let mut f = Fixture::new(cx);
    let root = f._root.path();
    assert!(
        std::process::Command::new(crate::platform::git::git_executable())
            .args(["-c", "init.defaultBranch=main", "init", "--template=", "-q"])
            .current_dir(root)
            .output()
            .unwrap()
            .status
            .success()
    );
    let path = root.join("report.docx");
    std::fs::write(&path, b"PK\0malformed package").unwrap();
    f.view.update(f.cx, |s, cx| {
        s.select(
            Change {
                path: "report.docx".into(),
                original: None,
                index: '?',
                worktree: '?',
            },
            false,
            cx,
        )
    });
    f.settle(|s| s.detail.as_ref().is_some_and(Detail::failed));
    f.view.read_with(f.cx, |s, _| {
        let Some(Ok(files)) = &s.detail.as_ref().unwrap().files else {
            panic!("a parsed Git diff with a Word error")
        };
        assert!(files[0].redline.as_ref().unwrap().is_err());
    });
    std::fs::write(
        &path,
        crate::platform::docx_redline::test_docx("<w:p><w:r><w:t>Recovered body</w:t></w:r></w:p>"),
    )
    .unwrap();
    f.click_retry();
    f.settle(|s| {
        s.detail
            .as_ref()
            .is_some_and(|d| d.files.is_some() && !d.failed())
    });
    f.view.read_with(f.cx, |s, _| {
        let files = s
            .detail
            .as_ref()
            .unwrap()
            .files
            .as_ref()
            .unwrap()
            .as_ref()
            .unwrap();
        let redline = files[0].redline.as_ref().unwrap().as_ref().unwrap();
        assert_eq!(redline.state, crate::platform::docx_redline::State::Added);
        assert_eq!(redline.changes.len(), 1);
        assert!(
            redline.changes[0]
                .segments
                .iter()
                .any(|part| part.text.contains("Recovered body"))
        );
        assert!(
            s.detail
                .as_ref()
                .unwrap()
                .rows
                .iter()
                .any(|row| matches!(row, diff::Row::Redline { .. }))
        );
    });
    assert!(f.cx.debug_bounds("git-diff-retry").is_none());
    assert!(
        matches!(f.requests.try_recv(), Err(mpsc::TryRecvError::Empty)),
        "test must use the real Git reader"
    );
}

#[gpui::test]
fn leaving_a_working_diff_for_history_cancels_its_reader(cx: &mut TestAppContext) {
    let mut f = Fixture::new(cx);
    let cancel = f.open("old.txt");
    let pending = f.request();
    f.view.update(f.cx, |s, cx| s.open_history(cx));
    assert!(
        cancel.load(Ordering::Relaxed),
        "leaving a diff must cancel its worker"
    );
    pending.finish(Ok(model("old.txt", "OLD MODEL")));
    f.draw();
    f.view
        .read_with(f.cx, |s, _| assert!(s.detail.is_none() && s.history_open));
}

#[gpui::test]
fn back_from_working_and_commit_details_cancels_the_read(cx: &mut TestAppContext) {
    let mut f = Fixture::new(cx);
    for commit in [false, true] {
        let cancel = if commit {
            let reader = f.reader.clone();
            f.view.update(f.cx, |s, cx| {
                s.history_open = true;
                s.open_detail(
                    DetailKind::Commit(CommitSummary {
                        id: "abcdef012345".into(),
                        parents: vec![],
                        author_name: "Author".into(),
                        author_email: "test@example.invalid".into(),
                        created_at: None,
                        message: "Selected commit".into(),
                        changes: vec![],
                    }),
                    move |root, cancel| reader(root, cancel),
                    cx,
                );
                s.detail_cancel.clone()
            })
        } else {
            f.open("old.txt")
        };
        let pending = f.request();
        f.draw();
        let back =
            f.cx.debug_bounds("git-diff-back")
                .expect("Back in detail header");
        f.cx.simulate_click(back.center(), Modifiers::default());
        assert!(cancel.load(Ordering::Relaxed));
        pending.finish(Ok(model("old.txt", "OLD MODEL")));
        f.draw();
        f.view.read_with(f.cx, |s, _| {
            assert!(s.detail.is_none());
            assert_eq!(s.history_open, commit);
        });
    }
}

#[cfg(unix)]
#[gpui::test]
fn workspace_changes_retire_the_actual_word_cache_and_its_worker_authority(
    cx: &mut TestAppContext,
) {
    let mut f = Fixture::new(cx);
    let root = f._root.path().to_path_buf();
    assert!(
        std::process::Command::new(crate::platform::git::git_executable())
            .args(["-c", "init.defaultBranch=main", "init", "--template=", "-q"])
            .current_dir(&root)
            .output()
            .unwrap()
            .status
            .success()
    );
    std::fs::write(
        root.join("report.docx"),
        crate::platform::docx_redline::test_docx("<w:p><w:r><w:t>Cached body</w:t></w:r></w:p>"),
    )
    .unwrap();
    let change = Change {
        path: "report.docx".into(),
        original: None,
        index: '?',
        worktree: '?',
    };
    f.view
        .update(f.cx, |s, cx| s.select(change.clone(), false, cx));
    f.settle(|s| {
        s.detail
            .as_ref()
            .is_some_and(|d| d.files.is_some() && !d.failed())
    });
    let old = f.view.read_with(f.cx, |s, _| s.diff_reader.clone());
    assert_eq!(old.cache_usage().0, 1);
    f.view.update(f.cx, |s, cx| {
        s.close_detail();
        s.select(change, false, cx);
    });
    f.settle(|s| {
        s.detail
            .as_ref()
            .is_some_and(|d| d.files.is_some() && !d.failed())
    });
    assert_eq!(old.cache_usage().0, 1);
    let next = tempfile::tempdir().unwrap();
    f.view
        .update(f.cx, |s, cx| s.set_workspace(next.path().into(), cx));
    assert_eq!(old.cache_usage(), (0, 0));
    f.view.read_with(f.cx, |s, _| {
        assert!(!Arc::ptr_eq(&old, &s.diff_reader));
        assert_eq!(s.diff_reader.cache_usage(), (0, 0));
        assert!(s.detail.is_none());
    });
    // Even a caller which still holds the old reader cannot refill it.
    old.file_diff(
        &root,
        "",
        "report.docx",
        None,
        Scope::Untracked,
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(old.cache_usage(), (0, 0));
}

fn with_recorded_word_view(
    test: impl FnOnce(&mut Fixture<'_>, &Arc<crate::test_support::RecordingText>),
) {
    let text = Arc::new(crate::test_support::RecordingText::default());
    let mut app =
        TestAppContext::build_with_text_system(TestDispatcher::new(0), None, text.clone());
    let mut fixture = Fixture::new(&mut app);
    test(&mut fixture, &text);
    drop(fixture);
    app.quit();
}
fn word_file(before: Option<&[u8]>, after: Option<&[u8]>) -> Vec<FileDiff> {
    let mut files = model("report.docx", "");
    files[0].binary = true;
    files[0].lines.clear();
    files[0].redline = Some(crate::platform::docx_redline::build(before, after));
    files
}
fn painted(text: &crate::test_support::RecordingText) -> String {
    text.0.lock().unwrap().join("\n")
}

#[test]
fn word_loading_resolves_to_an_honest_empty_body_state_in_the_actual_view() {
    with_recorded_word_view(|f, text| {
        f.open("report.docx");
        f.draw();
        assert!(painted(text).contains(tr("source-control.diff.docx.loading")));
        let bytes =
            crate::platform::docx_redline::test_docx("<w:p><w:r><w:t>Unchanged</w:t></w:r></w:p>");
        text.0.lock().unwrap().clear();
        f.request()
            .finish(Ok(word_file(Some(&bytes), Some(&bytes))));
        f.settle(|s| s.detail.as_ref().is_some_and(|d| d.files.is_some()));
        let drawn = painted(text);
        for key in [
            "source-control.diff.docx.state.empty",
            "source-control.diff.docx.noParagraphChanges",
            "source-control.diff.docx.fidelity.bodyTextV1",
        ] {
            assert!(drawn.contains(tr(key)), "{key}: {drawn}");
        }
        assert!(f.cx.debug_bounds("git-diff-retry").is_none());
    });
}

#[test]
fn word_provider_errors_show_the_reason_and_retry_in_the_actual_view() {
    with_recorded_word_view(|f, text| {
        f.open("report.docx");
        let files = word_file(None, Some(b"malformed package"));
        let reason = files[0]
            .redline
            .as_ref()
            .unwrap()
            .as_ref()
            .unwrap_err()
            .clone();
        f.request().finish(Ok(files));
        f.settle(|s| s.detail.as_ref().is_some_and(Detail::failed));
        let drawn = painted(text);
        assert!(
            drawn.contains(tr("source-control.diff.docx.unavailable")) && drawn.contains(&reason),
            "{drawn}"
        );
        assert!(drawn.contains(tr("common.action.retry")));
        f.retry();
        f.request().finish(Ok(word_file(
            None,
            Some(&crate::platform::docx_redline::test_docx(
                "<w:p><w:r><w:t>Repaired</w:t></w:r></w:p>",
            )),
        )));
        f.settle(|s| {
            s.detail
                .as_ref()
                .is_some_and(|d| d.files.is_some() && !d.failed())
        });
        assert!(painted(text).contains("Repaired"));
    });
}

#[test]
fn one_sided_word_documents_draw_their_distinct_state_and_content() {
    for added in [true, false] {
        with_recorded_word_view(|f, text| {
            f.open("report.docx");
            let bytes = crate::platform::docx_redline::test_docx(
                "<w:p><w:r><w:t>One-sided content</w:t></w:r></w:p>",
            );
            f.request().finish(Ok(if added {
                word_file(None, Some(&bytes))
            } else {
                word_file(Some(&bytes), None)
            }));
            f.settle(|s| s.detail.as_ref().is_some_and(|d| d.files.is_some()));
            let drawn = painted(text);
            let label = tr(if added {
                "source-control.diff.docx.state.added"
            } else {
                "source-control.diff.docx.state.deleted"
            });
            assert!(
                drawn.contains(&label.to_uppercase()) && drawn.contains("One-sided content"),
                "{drawn}"
            );
            assert!(
                drawn.contains(tr("source-control.diff.docx.fidelity.bodyTextV1")),
                "{drawn}"
            );
        });
    }
}
