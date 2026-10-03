def helper(a):
    return a * 2


def sum_local(a, b):
    """Appel direct à helper dans le même module, par ses globales (non observé, listé)."""
    return helper(a) + b
