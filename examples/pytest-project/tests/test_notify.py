import asyncio

from src.notify import schedule_welcome


def test_schedule_welcome():
    async def main():
        assert schedule_welcome({"email": "Ada@Example.com"}) is True
        await asyncio.sleep(0.01)

    asyncio.run(main())
