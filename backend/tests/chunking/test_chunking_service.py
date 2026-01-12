from src.chunking.service import ChunkingService


def test_chunk_text_basic_offsets_and_progress():
    svc = ChunkingService()
    text = "A" * 5000
    chunks = svc.chunk_text(text, chunk_size_chars=1000, chunk_overlap_chars=100)

    assert chunks
    assert chunks[0].char_start == 0
    assert chunks[-1].char_end == 5000
    assert all(c.char_end > c.char_start for c in chunks)

    # Ensure progress (no infinite loops / overlaps are bounded)
    for prev, cur in zip(chunks, chunks[1:]):
        assert cur.char_start < cur.char_end
        assert cur.char_start <= prev.char_end


def test_chunk_text_rejects_overlap_ge_size():
    svc = ChunkingService()
    try:
        svc.chunk_text("hello", chunk_size_chars=10, chunk_overlap_chars=10)
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_extract_large_strings_generates_json_pointer_and_escapes_tokens():
    svc = ChunkingService()
    data = {
        "a": {
            "b/c": [
                "short",
                "X" * 12,
            ],
            "t~k": "Y" * 12,
        }
    }

    nodes = svc.extract_large_strings(data, threshold_chars=10)
    pointers = sorted(n.json_pointer for n in nodes)

    # "b/c" -> "b~1c", "t~k" -> "t~0k"
    assert "/a/b~1c/1" in pointers
    assert "/a/t~0k" in pointers


def test_chunk_text_prefers_newline_boundaries():
    svc = ChunkingService()
    text = "line1\nline2\nline3\nline4\n"
    chunks = svc.chunk_text(text, chunk_size_chars=12, chunk_overlap_chars=0)

    assert len(chunks) >= 2
    # When possible, chunks should end on '\n'
    assert all(text[c.char_end - 1] == "\n" for c in chunks)

