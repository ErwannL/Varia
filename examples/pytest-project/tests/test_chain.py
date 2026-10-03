import asyncio

from src.chain import outer


def test_outer_parallel():
    async def main():
        return await asyncio.gather(outer("ab"), outer("abcd"))

    assert asyncio.run(main()) == [2, 4]
