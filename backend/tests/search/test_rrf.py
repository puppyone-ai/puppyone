from src.search.service import reciprocal_rank_fusion
from src.turbopuffer.schemas import TurbopufferRow


def test_rrf_fuses_and_dedupes_by_id_and_orders_by_score():
    # list1: A, B, C
    list1 = [
        TurbopufferRow(id="A", attributes={"content": "a"}),
        TurbopufferRow(id="B", attributes={"content": "b"}),
        TurbopufferRow(id="C", attributes={"content": "c"}),
    ]
    # list2: B, A, D
    list2 = [
        TurbopufferRow(id="B", attributes={"content": "b"}),
        TurbopufferRow(id="A", attributes={"content": "a"}),
        TurbopufferRow(id="D", attributes={"content": "d"}),
    ]

    fused = reciprocal_rank_fusion([list1, list2], k=60)
    ids = [row.id for row, _ in fused]

    # A 和 B 都在两份列表里，应该排在前面；且 A 在 list1 排名更高、B 在 list2 排名更高，二者相近
    assert set(ids[:2]) == {"A", "B"}
    # C 只在 list1，D 只在 list2，应排在后面
    assert set(ids[2:]) == {"C", "D"}

