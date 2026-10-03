import asyncio

sent = []


async def _send(user):
    sent.append(str.lower(user["email"]))


def schedule_welcome(user):
    """Envoi « plus tard », sans attendre : une adresse non textuelle provoque une exception de tâche
    jamais récupérée (TypeError), après le retour normal."""
    asyncio.get_running_loop().create_task(_send(user))
    return True
