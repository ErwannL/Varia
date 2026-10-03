import asyncio

import pytest

from src.users import create_user, fetch_user


class TestCreateUser:
    def test_valid(self):
        user = create_user({"name": "Erwann", "age": 25, "password": "hunter2-secret"})
        assert user["name"] == "Erwann"
        assert user["age"] == 25
        assert "password" not in user

    def test_three_users(self):
        a = create_user({"name": "Ada", "age": 36, "password": "pw-ada-secret"})
        b = create_user({"name": "Grace", "age": 45, "password": "pw-grace-secret"})
        c = create_user({"name": "Linus", "age": 21, "password": "pw-linus-secret"})
        assert [a["name"], b["name"], c["name"]] == ["Ada", "Grace", "Linus"]

    # Test paramétré : un test pytest par ligne.
    @pytest.mark.parametrize("name,age", [("Alice", 30), ("Bob", 40), ("Chloé", 50)])
    def test_accepts(self, name, age):
        assert create_user({"name": name, "age": age, "password": "pw-each-secret"})["name"] == name


def test_fetch_user_resolves():
    assert asyncio.run(fetch_user(7)) == {"id": 7, "name": "user-7"}
