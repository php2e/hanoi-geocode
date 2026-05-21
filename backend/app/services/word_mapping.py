import hashlib
import math


def stable_int(*parts: object) -> int:
    h = hashlib.sha256()
    for part in parts:
        h.update(str(part).encode("utf-8"))
        h.update(b"\0")
    return int.from_bytes(h.digest(), "big")


def modular_inverse(value: int, modulus: int) -> int:
    if math.gcd(value, modulus) != 1:
        raise ValueError("value is not invertible for modulus")
    return pow(value, -1, modulus)


def choose_multiplier(admin_slug: str, grid_version: str, boundary_version: str, pair_capacity: int) -> int:
    candidate = stable_int("multiplier", admin_slug, grid_version, boundary_version) % pair_capacity
    if candidate < 3:
        candidate = 3
    if candidate % 2 == 0:
        candidate += 1
    while math.gcd(candidate, pair_capacity) != 1:
        candidate += 2
        if candidate >= pair_capacity:
            candidate = 1
    return candidate


def choose_offset(admin_slug: str, grid_version: str, boundary_version: str, pair_capacity: int) -> int:
    return stable_int("offset", admin_slug, grid_version, boundary_version) % pair_capacity


def local_to_pair(local_index: int, word_count: int, multiplier: int, offset_value: int, pair_capacity: int) -> tuple[int, int, int]:
    permuted = (local_index * multiplier + offset_value) % pair_capacity
    return permuted, permuted // word_count, permuted % word_count


def pair_to_local(word1_id: int, word2_id: int, word_count: int, multiplier: int, offset_value: int, pair_capacity: int) -> int:
    permuted = word1_id * word_count + word2_id
    return ((permuted - offset_value) * modular_inverse(multiplier, pair_capacity)) % pair_capacity
