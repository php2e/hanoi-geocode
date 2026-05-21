from app.services.word_mapping import choose_multiplier, choose_offset, local_to_pair, pair_to_local


def test_local_index_word_pair_roundtrip():
    word_count = 101
    pair_capacity = word_count * word_count
    multiplier = choose_multiplier("ba-vi", "grid", "boundary", pair_capacity)
    offset = choose_offset("ba-vi", "grid", "boundary", pair_capacity)
    for local_index in [0, 1, 50, 999, 5000]:
        _, word1, word2 = local_to_pair(local_index, word_count, multiplier, offset, pair_capacity)
        assert pair_to_local(word1, word2, word_count, multiplier, offset, pair_capacity) == local_index
