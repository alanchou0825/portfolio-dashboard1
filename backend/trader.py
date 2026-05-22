"""Shioaji（永豐金）交易封裝層。

所有對 Shioaji API 的呼叫集中在此，main.py 只呼叫這裡的函式。
正式使用前請先用 simulation=True 測試（見 ERR-003 in CLAUDE.md）。
"""
import os
import shioaji as sj
from shioaji.constant import Action, StockPriceType, OrderType

_api: sj.Shioaji | None = None


def get_api() -> sj.Shioaji:
    global _api
    if _api is not None:
        return _api

    simulation = os.getenv("SHIOAJI_SIMULATION", "true").lower() == "true"
    _api = sj.Shioaji(simulation=simulation)
    _api.login(
        api_key=os.environ["SHIOAJI_API_KEY"],
        secret_key=os.environ["SHIOAJI_SECRET_KEY"],
    )

    # 憑證（正式帳戶才需要，simulation 模式可略過）
    if not simulation:
        _api.activate_ca(
            ca_path=os.environ["SHIOAJI_CA_PATH"],
            ca_passwd=os.environ["SHIOAJI_CA_PASSWD"],
            person_id=os.environ["SHIOAJI_PERSON_ID"],
        )

    return _api


def place_order(code: str, action: str, quantity: int, price: float | None) -> dict:
    """
    送出委託。
    action: 'Buy' | 'Sell'
    quantity: 股數（台股最小單位 1000 股 = 1 張）
    price: None = 市價單，有值 = 限價單
    """
    api = get_api()
    contract = api.Contracts.Stocks[code]
    order = api.Order(
        price=price if price else 0,
        quantity=quantity,
        action=Action.Buy if action == "Buy" else Action.Sell,
        price_type=StockPriceType.LMT if price else StockPriceType.MKT,
        order_type=OrderType.ROD,
        account=api.stock_account,
    )
    trade = api.place_order(contract, order)
    return {
        "order_id": trade.order.id,
        "status": str(trade.status.status),
        "code": code,
        "action": action,
        "quantity": quantity,
        "price": price,
    }


def get_positions() -> list[dict]:
    api = get_api()
    positions = api.list_positions(api.stock_account)
    return [
        {
            "code": p.code,
            "quantity": p.quantity,
            "price": p.price,
            "last_price": p.last_price,
            "pnl": p.pnl,
        }
        for p in (positions or [])
    ]


def get_account_balance() -> dict:
    api = get_api()
    account = api.stock_account
    settlements = api.settlements(account) or []
    balance = sum(getattr(s, "amount", 0) for s in settlements)
    return {"account_id": account.account_id, "balance": balance}
