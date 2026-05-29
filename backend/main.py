"""Portfolio Dashboard — 自動下單後端（FastAPI + Shioaji）

部署平台：Railway（免費方案）
正式使用前必須先在模擬帳戶測試（SHIOAJI_SIMULATION=true）
"""
import os
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from dotenv import load_dotenv
from trader import place_order, get_positions, get_account_balance

load_dotenv()

app = FastAPI(title="Portfolio Trader API", version="1.0.0")

# 只允許自己的 Vercel 網站呼叫（可在 Railway 環境變數覆蓋）
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "https://portfolio-dashboard1-iota.vercel.app,https://portfolio-dashboard1-ten.vercel.app"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-API-Token"],
)


def verify_token(request: Request) -> None:
    token = request.headers.get("X-API-Token", "")
    expected = os.environ.get("API_TOKEN", "")
    if not expected or token != expected:
        raise HTTPException(status_code=401, detail="未授權：Token 不正確")


class OrderRequest(BaseModel):
    code: str
    action: str        # 'Buy' | 'Sell'
    quantity: int      # 股數
    price: float | None = None  # None = 市價單

    @field_validator("action")
    @classmethod
    def validate_action(cls, v: str) -> str:
        if v not in ("Buy", "Sell"):
            raise ValueError("action 必須為 'Buy' 或 'Sell'")
        return v

    @field_validator("quantity")
    @classmethod
    def validate_quantity(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("quantity 必須大於 0")
        return v


@app.get("/health")
def health() -> dict:
    simulation = os.getenv("SHIOAJI_SIMULATION", "true").lower() == "true"
    return {"status": "ok", "mode": "模擬" if simulation else "正式"}


@app.get("/account")
def account_info(request: Request) -> dict:
    verify_token(request)
    try:
        return get_account_balance()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/positions")
def positions(request: Request) -> list:
    verify_token(request)
    try:
        return get_positions()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/order")
def order(req: OrderRequest, request: Request) -> dict:
    verify_token(request)
    try:
        return place_order(req.code, req.action, req.quantity, req.price)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
