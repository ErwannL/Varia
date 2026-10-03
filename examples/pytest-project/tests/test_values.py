import re

from src.math_utils import sum_local
from src.values import echo_value, exit_on, repeat, stamp


def test_echo_stamp():
    assert re.fullmatch(r"t:\d+", echo_value(stamp("t"))["received"])


def test_echo_value():
    assert echo_value("hello") == {"received": "hello"}


def test_repeat():
    assert repeat("a", 3) == "a"


def test_exit_on():
    assert exit_on("ok") == "ok"


def test_sum_local():
    assert sum_local(2, 3) == 7
