import pytest

from algopy_testing import AlgopyTestContext
from algopy_testing import algopy_testing_context

from smart_contracts.hello_world.contract import GoTagContract


@pytest.fixture
def context():
    with algopy_testing_context() as ctx:
        yield ctx


@pytest.fixture
def contract(context):
    return GoTagContract()


def test_contract_can_be_created(contract):
    assert contract is not None
