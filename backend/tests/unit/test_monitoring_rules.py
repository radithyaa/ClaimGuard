from datetime import UTC, datetime, timedelta

import pytest

from app.models import Shipment, TrackingEvent
from app.services.monitoring import evaluate

NOW = datetime(2026, 10, 22, 6, 0, tzinfo=UTC)


def ship(status: str, *, sla_days_ago: float = -2, report: str | None = None) -> Shipment:
    s = Shipment(tracking_number="X", courier="jne", status=status, origin="A", destination="B",
                 shipped_at=NOW - timedelta(days=5), sla_deadline=NOW - timedelta(days=sla_days_ago),
                 item_name="Barang", item_value=1, buyer_report=report)
    s.tracking_events = [TrackingEvent(status="Tiba di hub", location="Semarang",
                                       occurred_at=NOW - timedelta(days=4))]
    return s


@pytest.mark.parametrize("days,severity", [(0.5, "low"), (1.5, "medium"), (3, "high")])
def test_sla_exceeded_severity(days, severity):
    flag = evaluate(ship("in_transit", sla_days_ago=days), NOW)
    assert flag.code == "SLA_EXCEEDED" and flag.case_type == "lost" and flag.severity == severity
    assert flag.reason["days_late"] == pytest.approx(days, abs=0.1)
    assert "Semarang" in flag.reason["summary"]


def test_within_sla_or_grace_not_flagged():
    assert evaluate(ship("in_transit"), NOW) is None
    assert evaluate(ship("in_transit", sla_days_ago=0.5), NOW, grace_hours=24) is None


def test_delivered_damage_report():
    flag = evaluate(ship("delivered", report="Vas PECAH saat dibuka"), NOW)
    assert flag.code == "BUYER_REPORTED_DAMAGE" and flag.case_type == "damaged"
    assert evaluate(ship("delivered", report="Barang sudah diterima, terima kasih."), NOW) is None


def test_return_dispute():
    flag = evaluate(ship("returned", report="Paket yang diterima kosong"), NOW)
    assert flag.code == "RETURN_DISPUTE" and flag.case_type == "return_fraud"
    assert evaluate(ship("returned", report="Ukuran kebesaran"), NOW) is None
