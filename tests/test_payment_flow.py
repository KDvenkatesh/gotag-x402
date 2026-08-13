from backend.services.x402_service import (
    asset_transfer_matches_expected,
    build_real_payment_request,
)


def test_build_real_payment_request_uses_gtusd_asset_and_settlement_address():
    request = build_real_payment_request(
        gotag_id='GT-AP39-0001',
        service_id='FUEL-001',
        amount=2500000,
        service_name='Fuel',
    )

    assert request['payment_required'] is True
    assert request['currency'] == 'GTUSD'
    assert request['asset_id'] == 769016907
    assert request['to'] == '35VTBJ7SOB4QHJVTIFVT2HA2WBOSWDWB3IWJYHTU7GW64J34CHK3FZNWFM'
    assert request['amount'] == 2500000
    assert request['network'] == 'Algorand TestNet'


def test_asset_transfer_matches_expected_rejects_wrong_asset_or_receiver():
    valid = {
        'asset-transfer': {
            'sender': 'A7C5S3YV7Y2DZPR2VQPSQY5QPAHFM6N4YJ5H3UG5Y2E7RNG7BKTCYQ6KQY',
            'receiver': '35VTBJ7SOB4QHJVTIFVT2HA2WBOSWDWB3IWJYHTU7GW64J34CHK3FZNWFM',
            'asset_id': 769016907,
            'amount': 2500000,
        },
        'confirmed-round': 1234,
    }

    assert asset_transfer_matches_expected(valid, 'A7C5S3YV7Y2DZPR2VQPSQY5QPAHFM6N4YJ5H3UG5Y2E7RNG7BKTCYQ6KQY', 769016907, 2500000, '35VTBJ7SOB4QHJVTIFVT2HA2WBOSWDWB3IWJYHTU7GW64J34CHK3FZNWFM') is True
    assert asset_transfer_matches_expected(valid, 'A7C5S3YV7Y2DZPR2VQPSQY5QPAHFM6N4YJ5H3UG5Y2E7RNG7BKTCYQ6KQY', 769016908, 2500000, '35VTBJ7SOB4QHJVTIFVT2HA2WBOSWDWB3IWJYHTU7GW64J34CHK3FZNWFM') is False
    assert asset_transfer_matches_expected(valid, 'A7C5S3YV7Y2DZPR2VQPSQY5QPAHFM6N4YJ5H3UG5Y2E7RNG7BKTCYQ6KQY', 769016907, 2500001, '35VTBJ7SOB4QHJVTIFVT2HA2WBOSWDWB3IWJYHTU7GW64J34CHK3FZNWFM') is False
