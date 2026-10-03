import asyncio
import itertools

from src.errors import ValidationError

_ids = itertools.count(1)


def create_user(data):
    """name None/absent/vide => ValidationError ; mauvais type ({} , [] , 123) => TypeError."""
    name = data.get("name")
    if name is None:
        raise ValidationError("name is required")
    if isinstance(name, str) and name.strip() == "":
        raise ValidationError("name is empty")
    # Aucune vérification de type : str.strip sur un objet, une liste ou un nombre => TypeError.
    trimmed = str.strip(name)
    return {"id": next(_ids), "name": trimmed, "age": data.get("age")}


async def _load(user_id):
    await asyncio.sleep(0)
    if not isinstance(user_id, int) or isinstance(user_id, bool) or user_id <= 0:
        raise ValidationError("id must be a positive integer")
    return {"id": user_id, "name": "user-%d" % user_id}


def fetch_user(user_id):
    """Non déclarée `async` pour pouvoir lever synchroniquement ; rend sinon une coroutine qui rejette."""
    if isinstance(user_id, (dict, list)):
        raise TypeError("id must not be an object")
    return _load(user_id)
