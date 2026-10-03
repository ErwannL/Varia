import asyncio

from src import text


async def outer(x):
    """Appel transitif via l'export d'un autre module (profondeur 0 puis 1)."""
    await asyncio.sleep(0)
    return text.inner(x)
