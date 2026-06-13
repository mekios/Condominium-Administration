import os
from decimal import Decimal, ROUND_HALF_UP
from datetime import date
from io import BytesIO

from django.core.mail import EmailMessage
from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import (
    Apartment,
    ApartmentUser,
    Building,
    DesignatedVoter,
    ExpenseItem,
    HeatedWaterMeasurementInput,
    HeatingMeasurementInput,
    Invoice,
    InvoiceDocument,
    NotificationDispatch,
    PaymentRecord,
    Vote,
    VoteSession,
)
from .serializers import (
    ApartmentHeatingFactorsSerializer,
    ApartmentSerializer,
    BuildingSerializer,
    DesignatedVoterAssignSerializer,
    ExpenseItemSerializer,
    HeatedWaterBulkUpsertSerializer,
    HeatingMeasurementInputSerializer,
    HeatingBulkUpsertSerializer,
    HeatedWaterMeasurementInputSerializer,
    InvoiceMarkPaidSerializer,
    InvoiceAdjustmentInputSerializer,
    InvoiceGenerateSerializer,
    InvoiceSerializer,
    PaymentRecordSerializer,
    MonthlyMeasurementUpsertSerializer,
    VoteSerializer,
    VoteSessionSerializer,
    VoteSubmitSerializer,
)


def q2(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def q1(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)


def _recalculate_invoice_settlement(invoice: Invoice) -> None:
    paid_total = sum((Decimal(payment.amount) for payment in invoice.payments.all()), Decimal("0.00"))
    invoice.paid_total = q2(paid_total)
    invoice.outstanding_balance = q2(Decimal(invoice.invoice_total) - paid_total)
    if invoice.outstanding_balance <= Decimal("0") and invoice.paid_total > Decimal("0"):
        invoice.status = Invoice.Status.PAID
    elif invoice.status != Invoice.Status.DRAFT:
        invoice.status = Invoice.Status.ISSUED
    invoice.save(update_fields=["paid_total", "outstanding_balance", "status", "updated_at"])


def _allocate_amount_by_weights(total_amount: Decimal, weights: dict[int, Decimal]) -> dict[int, Decimal]:
    allocations = {apartment_id: Decimal("0.00") for apartment_id in weights.keys()}
    if not weights:
        return allocations
    sum_weights = sum(weights.values(), Decimal("0"))
    if sum_weights <= Decimal("0"):
        return allocations

    raw_allocations: dict[int, Decimal] = {}
    for apartment_id, weight in weights.items():
        if weight <= Decimal("0"):
            raw_allocations[apartment_id] = Decimal("0")
            continue
        raw_allocations[apartment_id] = total_amount * (weight / sum_weights)

    for apartment_id, raw_value in raw_allocations.items():
        allocations[apartment_id] = q2(raw_value)

    remainder = q2(total_amount - sum(allocations.values(), Decimal("0")))
    if remainder == Decimal("0"):
        return allocations

    cent = Decimal("0.01")
    max_steps = int(abs(remainder / cent))
    if max_steps == 0:
        return allocations

    if remainder > Decimal("0"):
        ordered_ids = sorted(
            raw_allocations.keys(),
            key=lambda apartment_id: (raw_allocations[apartment_id] - allocations[apartment_id]),
            reverse=True,
        )
        step = cent
    else:
        ordered_ids = sorted(
            raw_allocations.keys(),
            key=lambda apartment_id: (raw_allocations[apartment_id] - allocations[apartment_id]),
        )
        step = -cent

    if not ordered_ids:
        return allocations

    idx = 0
    for _ in range(max_steps):
        apartment_id = ordered_ids[idx % len(ordered_ids)]
        next_value = allocations[apartment_id] + step
        if next_value >= Decimal("0"):
            allocations[apartment_id] = q2(next_value)
        idx += 1

    return allocations


def month_after(month: str) -> str:
    y, m = month.split("-")
    year = int(y)
    month_int = int(m)
    if month_int == 12:
        return f"{year + 1}-01"
    return f"{year:04d}-{month_int + 1:02d}"


def date_after(value: date) -> date:
    if value.month == 12:
        return date(value.year + 1, 1, 1)
    return date(value.year, value.month + 1, 1)


def parse_month(value: str) -> tuple[int, int]:
    year_str, month_str = value.split("-")
    return int(year_str), int(month_str)


_PDF_FONTS_REGISTERED = False

_PDF_LOGO_PATH = os.path.join(os.path.dirname(__file__), "assets", "logo.png")


def _pdf_logo() -> ImageReader | None:
    if os.path.exists(_PDF_LOGO_PATH):
        return ImageReader(_PDF_LOGO_PATH)
    return None


def _register_pdf_fonts() -> tuple[str, str]:
    global _PDF_FONTS_REGISTERED
    if not _PDF_FONTS_REGISTERED:
        font_candidates = [
            (
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            ),
            (
                "/usr/share/fonts/dejavu/DejaVuSans.ttf",
                "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
            ),
        ]
        for regular_path, bold_path in font_candidates:
            if os.path.exists(regular_path) and os.path.exists(bold_path):
                pdfmetrics.registerFont(TTFont("AppSans", regular_path))
                pdfmetrics.registerFont(TTFont("AppSans-Bold", bold_path))
                _PDF_FONTS_REGISTERED = True
                return "AppSans", "AppSans-Bold"
    if "AppSans" in pdfmetrics.getRegisteredFontNames() and "AppSans-Bold" in pdfmetrics.getRegisteredFontNames():
        return "AppSans", "AppSans-Bold"
    return "Helvetica", "Helvetica-Bold"


def _format_currency(value: Decimal | str | int | float) -> str:
    decimal_value = Decimal(str(value))
    formatted = f"{decimal_value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{formatted} EUR"


def _status_label(status: str) -> str:
    if status == Invoice.Status.PAID:
        return "Εξοφλημένο"
    if status == Invoice.Status.ISSUED:
        return "Εκδομένο"
    return "Πρόχειρο"


_DESCRIPTION_AS_LABEL_CATEGORIES = {
    ExpenseItem.Category.DAMAGES,
    ExpenseItem.Category.ANNUAL_SERVICING,
    ExpenseItem.Category.OWNERS_ONLY,
    ExpenseItem.Category.FUND_INCREASE,
    ExpenseItem.Category.OTHER,
}


def _adjust_building_fund_balance(building_id: int, delta: Decimal) -> None:
    building = Building.objects.select_for_update().get(pk=building_id)
    building.fund_balance = q2(building.fund_balance + delta)
    building.save(update_fields=["fund_balance", "updated_at"])


def _reconcile_fund_increase_expense(
    *,
    old_building_id: int,
    old_category: str,
    old_amount: Decimal,
    new_building_id: int,
    new_category: str,
    new_amount: Decimal,
) -> None:
    if old_category == ExpenseItem.Category.FUND_INCREASE:
        _adjust_building_fund_balance(old_building_id, -old_amount)
    if new_category == ExpenseItem.Category.FUND_INCREASE:
        _adjust_building_fund_balance(new_building_id, new_amount)

_CHARGE_BUCKET_LABELS = {
    "heating_radiators_total": "Καλοριφέρ",
    "heated_water_energy_total": "Ζεστό νερό",
    "water_consumption_total": "Νερό",
    "common_recurring_total": "Κοινόχρηστα",
    "common_non_recurring_total": "Έκτακτα",
    "owners_only_total": "Μόνο ιδιοκτήτες",
}

_BUCKET_ORDER = [
    "heating_radiators_total",
    "heated_water_energy_total",
    "water_consumption_total",
    "common_recurring_total",
    "common_non_recurring_total",
    "owners_only_total",
]


def _expense_display_label(expense: ExpenseItem) -> str:
    category_label = expense.get_expense_category_display()
    if expense.expense_category in _DESCRIPTION_AS_LABEL_CATEGORIES and expense.description.strip():
        return f"{category_label}: {expense.description.strip()}"
    return category_label


def _record_expense_breakdown(
    breakdown: dict[int, list[dict]],
    *,
    building_apartments: list[Apartment],
    expense: ExpenseItem,
    expense_amount: Decimal,
    allocations: dict[int, Decimal],
    bucket_key: str,
) -> None:
    bucket_label = _CHARGE_BUCKET_LABELS[bucket_key]
    label = _expense_display_label(expense)
    date_str = expense.expense_date.isoformat()
    for apartment in building_apartments:
        share = allocations.get(apartment.id, Decimal("0.00"))
        if share <= Decimal("0"):
            continue
        breakdown[apartment.id].append(
            {
                "bucket_key": bucket_key,
                "bucket": bucket_label,
                "label": label,
                "date": date_str,
                "expense_total": expense_amount,
                "share": share,
            }
        )


def _build_grouped_invoice_pdf_rows(apartment_lines: list[dict]) -> tuple[list[list[str]], set[int]]:
    grouped: dict[str, list[dict]] = {bucket_key: [] for bucket_key in _BUCKET_ORDER}
    for line in apartment_lines:
        bucket_key = line.get("bucket_key")
        if bucket_key in grouped:
            grouped[bucket_key].append(line)

    rows: list[list[str]] = []
    emphasis_rows: set[int] = set()
    grand_share = Decimal("0.00")

    for bucket_key in _BUCKET_ORDER:
        lines = grouped[bucket_key]
        if not lines:
            continue

        rows.append([_CHARGE_BUCKET_LABELS[bucket_key], "", "", ""])
        emphasis_rows.add(len(rows) - 1)

        for line in sorted(lines, key=lambda item: (item["date"], item["label"])):
            rows.append(
                [
                    line["label"],
                    line["date"],
                    _format_currency(line["expense_total"]),
                    _format_currency(line["share"]),
                ]
            )
            grand_share += line["share"]

    rows.append(["Σύνολο", "", "", _format_currency(q2(grand_share))])
    emphasis_rows.add(len(rows) - 1)
    return rows, emphasis_rows


def _payment_method_label(method: str) -> str:
    mapping = {
        PaymentRecord.Method.CASH: "Μετρητά",
        PaymentRecord.Method.BANK_TRANSFER: "Τραπεζική μεταφορά",
        PaymentRecord.Method.CARD: "Κάρτα",
        PaymentRecord.Method.OTHER: "Άλλο",
    }
    return mapping.get(method, method)


def _build_branded_pdf(
    *,
    document_title: str,
    document_subtitle: str,
    meta_left: list[str],
    meta_right: list[str],
    row_headers: list[str],
    rows: list[list[str]],
    totals: list[tuple[str, str]],
    emphasis_rows: set[int] | None = None,
) -> bytes:
    normal_font, bold_font = _register_pdf_fonts()
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=66 * mm,
        bottomMargin=18 * mm,
    )

    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="AppBody",
            fontName=normal_font,
            fontSize=9.2,
            leading=11.2,
            textColor=colors.HexColor("#1A2A53"),
        )
    )
    styles.add(
        ParagraphStyle(
            name="AppBodyBold",
            parent=styles["AppBody"],
            fontName=bold_font,
            fontSize=9.2,
        )
    )

    def p(text: str, *, bold=False) -> Paragraph:
        return Paragraph(text.replace("\n", "<br/>"), styles["AppBodyBold" if bold else "AppBody"])

    story = [Spacer(1, 2 * mm)]

    meta_table_data = [
        [p(meta_left[0], bold=True), p(meta_right[0], bold=True)],
        [p(meta_left[1]), p(meta_right[1])],
        [p(meta_left[2]), p(meta_right[2])],
    ]
    meta_table = Table(meta_table_data, colWidths=[88 * mm, 88 * mm])
    meta_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F1EEF8")),
                ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#C8BAE2")),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#DBD1ED")),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.extend([meta_table, Spacer(1, 8 * mm)])

    table_data = [row_headers] + rows
    if len(row_headers) == 4:
        main_col_widths = [68 * mm, 26 * mm, 40 * mm, 42 * mm]
    else:
        main_col_widths = [120 * mm, 56 * mm]
    main_table = Table(table_data, colWidths=main_col_widths)
    table_style = [
        ("FONTNAME", (0, 0), (-1, 0), bold_font),
        ("FONTNAME", (0, 1), (-1, -1), normal_font),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2A4587")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("TEXTCOLOR", (0, 1), (-1, -1), colors.HexColor("#1A2A53")),
        ("LINEBELOW", (0, 0), (-1, 0), 1.6, colors.HexColor("#856DB3")),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("ALIGN", (1, 0), (1, -1), "LEFT"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#F7FAFF"), colors.HexColor("#F3EEFA")]),
        ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#C8BAE2")),
        ("INNERGRID", (0, 0), (-1, -1), 0.6, colors.HexColor("#DBD1ED")),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]
    for row_idx in emphasis_rows or set():
        table_row = row_idx + 1
        table_style.extend(
            [
                ("FONTNAME", (0, table_row), (-1, table_row), bold_font),
                ("BACKGROUND", (0, table_row), (-1, table_row), colors.HexColor("#E8E0F4")),
            ]
        )
    main_table.setStyle(TableStyle(table_style))
    story.extend([main_table, Spacer(1, 8 * mm)])

    totals_table = Table([[label, value] for label, value in totals], colWidths=[120 * mm, 56 * mm])
    totals_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#1D2F5F")),
                ("TEXTCOLOR", (0, 0), (-1, -1), colors.white),
                ("FONTNAME", (0, 0), (-1, -1), normal_font),
                ("FONTNAME", (0, 0), (-1, 0), bold_font),
                ("FONTNAME", (1, 0), (1, -1), bold_font),
                ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#3E5FA2")),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#34528E")),
                ("LINEABOVE", (0, 0), (-1, 0), 1.6, colors.HexColor("#B9A6D6")),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(totals_table)

    def draw_header(canvas, _doc):
        page_w, page_h = A4
        canvas.saveState()

        # Full-color logo on a light header.
        logo = _pdf_logo()
        if logo is not None:
            logo_h = 24 * mm
            iw, ih = logo.getSize()
            logo_w = logo_h * (iw / ih)
            canvas.drawImage(
                logo,
                14 * mm,
                page_h - 14 * mm - logo_h,
                width=logo_w,
                height=logo_h,
                mask="auto",
                preserveAspectRatio=True,
            )
        else:
            canvas.setFillColor(colors.HexColor("#1A2A53"))
            canvas.setFont(bold_font, 13)
            canvas.drawString(14 * mm, page_h - 24 * mm, "ΜΕΤΑΜΟΡΦΩΣΕΩΣ 5")

        # Document title block (right aligned).
        canvas.setFillColor(colors.HexColor("#1A2A53"))
        canvas.setFont(bold_font, 18)
        canvas.drawRightString(page_w - 14 * mm, page_h - 24 * mm, document_title)
        canvas.setFillColor(colors.HexColor("#6B7EA8"))
        canvas.setFont(normal_font, 9.5)
        canvas.drawRightString(page_w - 14 * mm, page_h - 30 * mm, document_subtitle)

        # Brand accent rule under the header.
        canvas.setStrokeColor(colors.HexColor("#2A4587"))
        canvas.setLineWidth(1.4)
        canvas.line(14 * mm, page_h - 44 * mm, page_w - 14 * mm, page_h - 44 * mm)

        canvas.setFillColor(colors.HexColor("#6B7EA8"))
        canvas.setFont(normal_font, 8)
        canvas.drawString(14 * mm, 10 * mm, "Παραγόμενο αρχείο από την ΕΦΑΡΜΟΓΗ ΔΙΑΧΕΙΡΙΣΗΣ")
        canvas.restoreState()

    doc.build(story, onFirstPage=draw_header, onLaterPages=draw_header)
    return buffer.getvalue()


def _create_receipt_pdf(invoice: Invoice, payment: PaymentRecord) -> tuple[str, bytes]:
    apartment_label = invoice.apartment.apartment_label
    meta_left = [
        f"Διαμέρισμα: {apartment_label}",
        f"Μήνας λογαριασμού: {invoice.month}",
        f"Ημερομηνία πληρωμής: {payment.payment_date.isoformat()}",
    ]
    meta_right = [
        f"Κατάσταση: {_status_label(invoice.status)}",
        f"Μέθοδος: {_payment_method_label(payment.method)}",
        f"Αναφορά: {payment.reference or '-'}",
    ]
    rows = [
        ["Πληρωθέν ποσό", _format_currency(payment.amount)],
        ["Υπόλοιπο μετά την πληρωμή", _format_currency(invoice.outstanding_balance)],
    ]
    totals = [
        ("Σύνολο απόδειξης", _format_currency(payment.amount)),
        ("Σύνολο λογαριασμού", _format_currency(invoice.invoice_total)),
        ("Υπόλοιπο", _format_currency(invoice.outstanding_balance)),
    ]
    pdf_bytes = _build_branded_pdf(
        document_title="ΑΠΟΔΕΙΞΗ ΠΛΗΡΩΜΗΣ",
        document_subtitle="Επίσημο έγγραφο εξόφλησης",
        meta_left=meta_left,
        meta_right=meta_right,
        row_headers=["Περιγραφή", "Ποσό"],
        rows=rows,
        totals=totals,
    )
    filename = f"receipt-{invoice.month}-{apartment_label}.pdf".replace(" ", "_")
    return filename, pdf_bytes


def _invoice_computed_total(invoice: Invoice) -> Decimal:
    return q2(
        invoice.heating_radiators_total
        + invoice.heated_water_energy_total
        + invoice.water_consumption_total
        + invoice.common_recurring_total
        + invoice.common_non_recurring_total
        + invoice.owners_only_total
    )


def _invoice_pdf_totals(invoice: Invoice) -> list[tuple[str, str]]:
    custom_adjustment = q2(invoice.custom_adjustment or Decimal("0.00"))
    totals: list[tuple[str, str]] = []
    if custom_adjustment != Decimal("0.00"):
        totals.append(("Υπολογισμένο σύνολο", _format_currency(_invoice_computed_total(invoice))))
        adjustment_label = "Προσαρμογή"
        if invoice.custom_adjustment_note:
            adjustment_label = f"{adjustment_label}: {invoice.custom_adjustment_note}"
        totals.append((adjustment_label, _format_currency(custom_adjustment)))
    totals.extend(
        [
            ("Σύνολο λογαριασμού", _format_currency(invoice.invoice_total)),
            ("Πληρωμένο", _format_currency(invoice.paid_total)),
            ("Υπόλοιπο", _format_currency(invoice.outstanding_balance)),
        ]
    )
    return totals


def _create_invoice_pdf(invoice: Invoice) -> tuple[str, bytes]:
    apartment_label = invoice.apartment.apartment_label
    meta_left = [
        f"Διαμέρισμα: {apartment_label}",
        f"Μήνας χρέωσης: {invoice.month}",
        f"Κατάσταση: {_status_label(invoice.status)}",
    ]
    meta_right = [
        f"Πληρωμένο: {_format_currency(invoice.paid_total)}",
        f"Υπόλοιπο: {_format_currency(invoice.outstanding_balance)}",
        "Τύπος: Μηνιαίος λογαριασμός",
    ]
    totals = _invoice_pdf_totals(invoice)

    row_headers = ["Έξοδο", "Ημερομηνία", "Σύνολο εξόδου", "Μερίδιο"]
    rows: list[list[str]] = []
    emphasis_rows: set[int] = set()
    result, error = _calculate_invoice_rows(invoice.month)
    if not error:
        _, _, breakdown = result
        apartment_lines = breakdown.get(invoice.apartment_id, [])
        if apartment_lines:
            rows, emphasis_rows = _build_grouped_invoice_pdf_rows(apartment_lines)

    if not rows:
        row_headers = ["Κατηγορία χρέωσης", "Ποσό"]
        rows = [
            ["Καλοριφέρ", _format_currency(invoice.heating_radiators_total)],
            ["Ζεστό νερό", _format_currency(invoice.heated_water_energy_total)],
            ["Νερό", _format_currency(invoice.water_consumption_total)],
            ["Κοινόχρηστα", _format_currency(invoice.common_recurring_total)],
            ["Έκτακτα", _format_currency(invoice.common_non_recurring_total)],
            ["Μόνο ιδιοκτήτες", _format_currency(invoice.owners_only_total)],
        ]

    custom_adjustment = q2(invoice.custom_adjustment or Decimal("0.00"))
    if custom_adjustment != Decimal("0.00"):
        label = "Προσαρμογή"
        if invoice.custom_adjustment_note:
            label = f"{label}: {invoice.custom_adjustment_note}"
        if len(row_headers) == 4:
            rows.append([label, "", "", _format_currency(custom_adjustment)])
            emphasis_rows = set(emphasis_rows or set())
            emphasis_rows.add(len(rows) - 1)
        else:
            rows.append([label, _format_currency(custom_adjustment)])

    pdf_bytes = _build_branded_pdf(
        document_title="ΜΗΝΙΑΙΟΣ ΛΟΓΑΡΙΑΣΜΟΣ",
        document_subtitle="Ανάλυση χρεώσεων διαμερίσματος",
        meta_left=meta_left,
        meta_right=meta_right,
        row_headers=row_headers,
        rows=rows,
        totals=totals,
        emphasis_rows=emphasis_rows if rows and len(row_headers) == 4 else None,
    )
    filename = f"invoice-{invoice.month}-{apartment_label}.pdf".replace(" ", "_")
    return filename, pdf_bytes


def _send_receipt_email(invoice: Invoice, payment: PaymentRecord, receipt_filename: str, receipt_pdf: bytes, *, force=False):
    if not force:
        already_sent = NotificationDispatch.objects.filter(
            invoice=invoice,
            payment=payment,
            notification_type=NotificationDispatch.NotificationType.RECEIPT_PAID,
            status=NotificationDispatch.Status.SENT,
        ).exists()
        if already_sent:
            return None

    recipient_emails = list(
        invoice.apartment.memberships.exclude(user__email="").values_list("user__email", flat=True).distinct()
    )
    if not recipient_emails:
        return NotificationDispatch.objects.create(
            invoice=invoice,
            payment=payment,
            notification_type=NotificationDispatch.NotificationType.RECEIPT_PAID,
            status=NotificationDispatch.Status.SKIPPED,
            error_message="Δεν υπάρχουν email παραληπτών για το διαμέρισμα.",
        )

    subject = f"Απόδειξη πληρωμής λογαριασμού {invoice.month}"
    body = (
        f"Η πληρωμή για το διαμέρισμα {invoice.apartment.apartment_label} καταχωρίστηκε.\n"
        f"Ποσό: {payment.amount}\n"
        f"Ημερομηνία πληρωμής: {payment.payment_date.isoformat()}\n"
        f"Υπόλοιπο: {invoice.outstanding_balance}\n"
    )
    dispatch = NotificationDispatch.objects.create(
        invoice=invoice,
        payment=payment,
        notification_type=NotificationDispatch.NotificationType.RECEIPT_PAID,
        recipient_email=",".join(recipient_emails),
        status=NotificationDispatch.Status.QUEUED,
    )
    try:
        message = EmailMessage(subject=subject, body=body, to=recipient_emails)
        message.attach(receipt_filename, receipt_pdf, "application/pdf")
        message.send(fail_silently=False)
        dispatch.status = NotificationDispatch.Status.SENT
        dispatch.sent_at = timezone.now()
        dispatch.save(update_fields=["status", "sent_at"])
    except Exception as exc:  # pragma: no cover - tested via status path
        dispatch.status = NotificationDispatch.Status.FAILED
        dispatch.error_message = str(exc)
        dispatch.save(update_fields=["status", "error_message"])
    return dispatch


def _send_invoice_email(invoice: Invoice, invoice_filename: str, invoice_pdf: bytes, *, force=False):
    if not force:
        already_sent = NotificationDispatch.objects.filter(
            invoice=invoice,
            payment__isnull=True,
            notification_type=NotificationDispatch.NotificationType.INVOICE_MONTHLY,
            status=NotificationDispatch.Status.SENT,
        ).exists()
        if already_sent:
            return NotificationDispatch.objects.create(
                invoice=invoice,
                notification_type=NotificationDispatch.NotificationType.INVOICE_MONTHLY,
                status=NotificationDispatch.Status.SKIPPED,
                error_message="Η μηνιαία αποστολή έχει ήδη ολοκληρωθεί για αυτόν τον λογαριασμό.",
            )

    recipient_emails = list(
        invoice.apartment.memberships.exclude(user__email="").values_list("user__email", flat=True).distinct()
    )
    if not recipient_emails:
        return NotificationDispatch.objects.create(
            invoice=invoice,
            notification_type=NotificationDispatch.NotificationType.INVOICE_MONTHLY,
            status=NotificationDispatch.Status.SKIPPED,
            error_message="Δεν υπάρχουν email παραληπτών για το διαμέρισμα.",
        )

    subject = f"Μηνιαίος λογαριασμός {invoice.month} - {invoice.apartment.apartment_label}"
    body = (
        f"Επισυνάπτεται ο μηνιαίος λογαριασμός για το διαμέρισμα {invoice.apartment.apartment_label}.\n"
        f"Μήνας: {invoice.month}\n"
        f"Σύνολο: {invoice.invoice_total}\n"
        f"Υπόλοιπο: {invoice.outstanding_balance}\n"
    )
    dispatch = NotificationDispatch.objects.create(
        invoice=invoice,
        notification_type=NotificationDispatch.NotificationType.INVOICE_MONTHLY,
        recipient_email=",".join(recipient_emails),
        status=NotificationDispatch.Status.QUEUED,
    )
    try:
        message = EmailMessage(subject=subject, body=body, to=recipient_emails)
        message.attach(invoice_filename, invoice_pdf, "application/pdf")
        message.send(fail_silently=False)
        dispatch.status = NotificationDispatch.Status.SENT
        dispatch.sent_at = timezone.now()
        dispatch.save(update_fields=["status", "sent_at"])
    except Exception as exc:  # pragma: no cover
        dispatch.status = NotificationDispatch.Status.FAILED
        dispatch.error_message = str(exc)
        dispatch.save(update_fields=["status", "error_message"])
    return dispatch


def _measurement_context_for_expense(building_apartments, expense: ExpenseItem, month: str):
    apartment_ids = [apartment.id for apartment in building_apartments]
    heating_qs = HeatingMeasurementInput.objects.filter(apartment_id__in=apartment_ids)
    water_qs = HeatedWaterMeasurementInput.objects.filter(apartment_id__in=apartment_ids)

    if expense.affected_period_start and expense.affected_period_end:
        # Use closest boundary readings for the selected range:
        # consumption = reading(closest to end) - reading(closest to start).
        heating_by_apartment: dict[int, list[HeatingMeasurementInput]] = {apartment.id: [] for apartment in building_apartments}
        for item in heating_qs.order_by("measurement_date", "id"):
            heating_by_apartment[item.apartment_id].append(item)

        water_by_apartment: dict[int, list[HeatedWaterMeasurementInput]] = {apartment.id: [] for apartment in building_apartments}
        for item in water_qs.order_by("measurement_date", "id"):
            water_by_apartment[item.apartment_id].append(item)

        apartment_units = {apartment.id: Decimal("0") for apartment in building_apartments}
        apartment_fixed = {apartment.id: Decimal("0") for apartment in building_apartments}
        volume_map = {apartment.id: Decimal("0") for apartment in building_apartments}

        start_date = expense.affected_period_start
        end_date = expense.affected_period_end

        for apartment in building_apartments:
            heating_rows = heating_by_apartment.get(apartment.id, [])
            if heating_rows:
                start_h = min(heating_rows, key=lambda row: abs((row.measurement_date - start_date).days))
                end_h = min(heating_rows, key=lambda row: abs((row.measurement_date - end_date).days))
                units_delta = Decimal(end_h.current_reading) - Decimal(start_h.current_reading)
                apartment_units[apartment.id] = units_delta if units_delta > Decimal("0") else Decimal("0")
                apartment_fixed[apartment.id] = Decimal(end_h.f_factor) * Decimal(end_h.e_factor)

            water_rows = water_by_apartment.get(apartment.id, [])
            if water_rows:
                start_w = min(water_rows, key=lambda row: abs((row.measurement_date - start_date).days))
                end_w = min(water_rows, key=lambda row: abs((row.measurement_date - end_date).days))
                volume_delta = Decimal(end_w.current_reading) - Decimal(start_w.current_reading)
                volume_map[apartment.id] = volume_delta if volume_delta > Decimal("0") else Decimal("0")

        sum_units = sum(apartment_units.values(), Decimal("0"))
        sum_fixed = sum(apartment_fixed.values(), Decimal("0"))
        if sum_fixed < Decimal("0") or sum_fixed > Decimal("1"):
            return None, (
                f"Μη έγκυροι συντελεστές θέρμανσης για το κτίριο {building_apartments[0].building_id}: "
                "Το άθροισμα(fi*ei) πρέπει να είναι μεταξύ 0 και 1."
            )

        radiator_share_map = {apartment.id: Decimal("0") for apartment in building_apartments}
        if sum_units > Decimal("0"):
            for apartment in building_apartments:
                units = apartment_units.get(apartment.id, Decimal("0"))
                fixed_component = apartment_fixed.get(apartment.id, Decimal("0"))
                variable_component = (units / sum_units) * (Decimal("1") - sum_fixed)
                radiator_share_map[apartment.id] = fixed_component + variable_component

        share_sum = sum(radiator_share_map.values(), Decimal("0"))
        if share_sum > Decimal("0"):
            for apartment_id in radiator_share_map.keys():
                radiator_share_map[apartment_id] = radiator_share_map[apartment_id] / share_sum

        total_volume = sum(volume_map.values(), Decimal("0"))
        return {
            "radiator_share_map": radiator_share_map,
            "volume_map": volume_map,
            "total_volume": total_volume,
        }, None
    else:
        year, month_no = parse_month(month)
        heating_qs = heating_qs.filter(measurement_date__year=year, measurement_date__month=month_no)
        water_qs = water_qs.filter(measurement_date__year=year, measurement_date__month=month_no)

    apartment_units = {apartment.id: Decimal("0") for apartment in building_apartments}
    apartment_fixed = {apartment.id: Decimal("0") for apartment in building_apartments}
    for heating_input in heating_qs.order_by("-measurement_date", "-id"):
        apartment_units[heating_input.apartment_id] += Decimal(heating_input.units_counted)
        if apartment_fixed[heating_input.apartment_id] == Decimal("0"):
            apartment_fixed[heating_input.apartment_id] = Decimal(heating_input.f_factor) * Decimal(heating_input.e_factor)

    sum_units = sum(apartment_units.values(), Decimal("0"))
    sum_fixed = sum(apartment_fixed.values(), Decimal("0"))
    if sum_fixed < Decimal("0") or sum_fixed > Decimal("1"):
        return None, (
            f"Μη έγκυροι συντελεστές θέρμανσης για το κτίριο {building_apartments[0].building_id}: "
            "Το άθροισμα(fi*ei) πρέπει να είναι μεταξύ 0 και 1."
        )

    radiator_share_map = {apartment.id: Decimal("0") for apartment in building_apartments}
    if sum_units > Decimal("0"):
        for apartment in building_apartments:
            units = apartment_units.get(apartment.id, Decimal("0"))
            fixed_component = apartment_fixed.get(apartment.id, Decimal("0"))
            variable_component = (units / sum_units) * (Decimal("1") - sum_fixed)
            radiator_share_map[apartment.id] = fixed_component + variable_component

    share_sum = sum(radiator_share_map.values(), Decimal("0"))
    if share_sum > Decimal("0"):
        for apartment_id in radiator_share_map.keys():
            radiator_share_map[apartment_id] = radiator_share_map[apartment_id] / share_sum

    volume_map = {apartment.id: Decimal("0") for apartment in building_apartments}
    for water_input in water_qs:
        volume_map[water_input.apartment_id] += Decimal(water_input.computed_heating_water_volume)
    total_volume = sum(volume_map.values(), Decimal("0"))

    return {
        "radiator_share_map": radiator_share_map,
        "volume_map": volume_map,
        "total_volume": total_volume,
    }, None


def _invoice_generation_warnings(month: str, apartments, rows) -> list[str]:
    warnings: list[str] = []
    apartments_by_building: dict[int, list[Apartment]] = {}
    for apartment in apartments:
        apartments_by_building.setdefault(apartment.building_id, []).append(apartment)

    expenses_by_building: dict[int, list[ExpenseItem]] = {}
    for expense in ExpenseItem.objects.filter(month=month):
        expenses_by_building.setdefault(expense.building_id, []).append(expense)

    for building_id, building_apartments in apartments_by_building.items():
        expenses = expenses_by_building.get(building_id, [])
        has_gas_heating = any(exp.expense_category == ExpenseItem.Category.GAS_HEATING for exp in expenses)
        has_water_hw = any(exp.expense_category == ExpenseItem.Category.WATER_HW_CONSUMPTION for exp in expenses)
        has_gas_hw = any(exp.expense_category == ExpenseItem.Category.GAS_HW_CONSUMPTION for exp in expenses)

        heating_total = sum(rows[apt.id]["heating_radiators_total"] for apt in building_apartments)
        water_total = sum(rows[apt.id]["water_consumption_total"] for apt in building_apartments)
        hw_energy_total = sum(rows[apt.id]["heated_water_energy_total"] for apt in building_apartments)

        if has_gas_heating and q2(heating_total) == Decimal("0.00"):
            warnings.append(
                f"Μήνας {month}: Δεν κατανέμεται το φυσικό αέριο θέρμανσης για κτίριο {building_id} (μηδενικές/ελλιπείς μετρήσεις)."
            )
        if has_water_hw and q2(water_total) == Decimal("0.00"):
            warnings.append(
                f"Μήνας {month}: Δεν κατανέμεται το κόστος κατανάλωσης ζεστού νερού για κτίριο {building_id} (μηδενικές/ελλιπείς μετρήσεις)."
            )
        if has_gas_hw and q2(hw_energy_total) == Decimal("0.00"):
            warnings.append(
                f"Μήνας {month}: Δεν κατανέμεται το φυσικό αέριο ζεστού νερού για κτίριο {building_id} (μηδενικές/ελλιπείς μετρήσεις)."
            )

    return warnings


def _computed_invoice_total(data: dict) -> Decimal:
    return q2(
        data["heating_radiators_total"]
        + data["heated_water_energy_total"]
        + data["water_consumption_total"]
        + data["common_recurring_total"]
        + data["common_non_recurring_total"]
        + data["owners_only_total"]
    )


def _parse_invoice_adjustments(raw_adjustments, valid_apartment_ids: set[int]) -> dict[int, dict]:
    serializer = InvoiceAdjustmentInputSerializer(data=raw_adjustments or [], many=True)
    serializer.is_valid(raise_exception=True)
    adjustments: dict[int, dict] = {}
    for item in serializer.validated_data:
        apartment_id = item["apartment"]
        if apartment_id not in valid_apartment_ids:
            continue
        adjustments[apartment_id] = {
            "amount": q2(item["amount"]),
            "note": (item.get("note") or "").strip(),
        }
    return adjustments


def _resolve_invoice_adjustment(
    apartment_id: int,
    *,
    adjustments_provided: bool,
    adjustments_map: dict[int, dict],
    existing_invoice: Invoice | None,
) -> tuple[Decimal, str]:
    if adjustments_provided:
        adjustment = adjustments_map.get(apartment_id, {"amount": Decimal("0.00"), "note": ""})
        return q2(adjustment["amount"]), adjustment.get("note", "")
    if existing_invoice is not None:
        return q2(existing_invoice.custom_adjustment or Decimal("0.00")), existing_invoice.custom_adjustment_note or ""
    return Decimal("0.00"), ""


def _build_preview_invoice_item(apartment, month: str, data: dict, existing_invoice: Invoice | None) -> dict:
    computed_total = _computed_invoice_total(data)
    custom_adjustment, custom_note = _resolve_invoice_adjustment(
        apartment.id,
        adjustments_provided=False,
        adjustments_map={},
        existing_invoice=existing_invoice,
    )
    return {
        "apartment": apartment.id,
        "apartment_unit_code": apartment.apartment_label,
        "month": month,
        "heating_radiators_total": q2(data["heating_radiators_total"]),
        "heated_water_energy_total": q2(data["heated_water_energy_total"]),
        "water_consumption_total": q2(data["water_consumption_total"]),
        "common_recurring_total": q2(data["common_recurring_total"]),
        "common_non_recurring_total": q2(data["common_non_recurring_total"]),
        "owners_only_total": q2(data["owners_only_total"]),
        "computed_total": computed_total,
        "custom_adjustment": custom_adjustment,
        "custom_adjustment_note": custom_note,
        "invoice_total": q2(computed_total + custom_adjustment),
    }


def _calculate_invoice_rows(month: str):
    apartments = list(Apartment.objects.select_related("building").all().order_by("unit_code"))
    if not apartments:
        return None, {"detail": "Δεν βρέθηκαν διαμερίσματα."}

    recurring_categories = {
        ExpenseItem.Category.GARDENER,
        ExpenseItem.Category.COMMON_POWER,
        ExpenseItem.Category.COMMON_WATER,
        ExpenseItem.Category.CLEANING,
        ExpenseItem.Category.ELEVATOR,
    }
    non_recurring_categories = {
        ExpenseItem.Category.DAMAGES,
        ExpenseItem.Category.ANNUAL_SERVICING,
        ExpenseItem.Category.OTHER,
    }
    owners_only_categories = {
        ExpenseItem.Category.OWNERS_ONLY,
    }

    expenses_by_building = {}
    for expense in ExpenseItem.objects.filter(month=month):
        expenses_by_building.setdefault(expense.building_id, []).append(expense)

    apartments_by_building = {}
    for apartment in apartments:
        apartments_by_building.setdefault(apartment.building_id, []).append(apartment)

    measurement_context_cache = {}
    rows = {}
    breakdown: dict[int, list[dict]] = {}
    for apartment in apartments:
        rows[apartment.id] = {
            "heating_radiators_total": Decimal("0"),
            "heated_water_energy_total": Decimal("0"),
            "water_consumption_total": Decimal("0"),
            "common_recurring_total": Decimal("0"),
            "common_non_recurring_total": Decimal("0"),
            "owners_only_total": Decimal("0"),
        }
        breakdown[apartment.id] = []

    for building_id, building_apartments in apartments_by_building.items():
        for expense in expenses_by_building.get(building_id, []):
            if expense.expense_category == ExpenseItem.Category.FUND_INCREASE:
                continue
            if expense.expense_category in (
                ExpenseItem.Category.GAS_HEATING,
                ExpenseItem.Category.WATER_HW_CONSUMPTION,
                ExpenseItem.Category.GAS_HW_CONSUMPTION,
            ):
                cache_key = (
                    building_id,
                    str(expense.affected_period_start or ""),
                    str(expense.affected_period_end or ""),
                    month,
                )
                if cache_key not in measurement_context_cache:
                    context, error_message = _measurement_context_for_expense(building_apartments, expense, month)
                    if error_message:
                        return None, {"detail": error_message}
                    measurement_context_cache[cache_key] = context
                context = measurement_context_cache[cache_key]
            else:
                context = None

            expense_amount = Decimal(expense.amount)
            weights: dict[int, Decimal] | None = None
            target_key: str | None = None
            if expense.expense_category == ExpenseItem.Category.GAS_HEATING:
                weights = {apt.id: context["radiator_share_map"].get(apt.id, Decimal("0")) for apt in building_apartments}
                target_key = "heating_radiators_total"
            elif expense.expense_category == ExpenseItem.Category.WATER_HW_CONSUMPTION:
                weights = {apt.id: context["volume_map"].get(apt.id, Decimal("0")) for apt in building_apartments}
                target_key = "water_consumption_total"
            elif expense.expense_category == ExpenseItem.Category.GAS_HW_CONSUMPTION:
                weights = {apt.id: context["volume_map"].get(apt.id, Decimal("0")) for apt in building_apartments}
                target_key = "heated_water_energy_total"

            if weights is not None and target_key is not None:
                allocations = _allocate_amount_by_weights(expense_amount, weights)
                for apartment in building_apartments:
                    rows[apartment.id][target_key] += allocations.get(apartment.id, Decimal("0.00"))
                _record_expense_breakdown(
                    breakdown,
                    building_apartments=building_apartments,
                    expense=expense,
                    expense_amount=expense_amount,
                    allocations=allocations,
                    bucket_key=target_key,
                )
            elif expense.expense_category in recurring_categories:
                ownership_weights = {
                    apartment.id: Decimal(apartment.ownership_permille) / Decimal("1000") for apartment in building_apartments
                }
                allocations = _allocate_amount_by_weights(expense_amount, ownership_weights)
                for apartment in building_apartments:
                    rows[apartment.id]["common_recurring_total"] += allocations.get(apartment.id, Decimal("0.00"))
                _record_expense_breakdown(
                    breakdown,
                    building_apartments=building_apartments,
                    expense=expense,
                    expense_amount=expense_amount,
                    allocations=allocations,
                    bucket_key="common_recurring_total",
                )
            elif expense.expense_category in non_recurring_categories:
                ownership_weights = {
                    apartment.id: Decimal(apartment.ownership_permille) / Decimal("1000") for apartment in building_apartments
                }
                allocations = _allocate_amount_by_weights(expense_amount, ownership_weights)
                for apartment in building_apartments:
                    rows[apartment.id]["common_non_recurring_total"] += allocations.get(apartment.id, Decimal("0.00"))
                _record_expense_breakdown(
                    breakdown,
                    building_apartments=building_apartments,
                    expense=expense,
                    expense_amount=expense_amount,
                    allocations=allocations,
                    bucket_key="common_non_recurring_total",
                )
            elif expense.expense_category in owners_only_categories:
                ownership_weights = {
                    apartment.id: Decimal(apartment.ownership_permille) / Decimal("1000") for apartment in building_apartments
                }
                allocations = _allocate_amount_by_weights(expense_amount, ownership_weights)
                for apartment in building_apartments:
                    rows[apartment.id]["owners_only_total"] += allocations.get(apartment.id, Decimal("0.00"))
                _record_expense_breakdown(
                    breakdown,
                    building_apartments=building_apartments,
                    expense=expense,
                    expense_amount=expense_amount,
                    allocations=allocations,
                    bucket_key="owners_only_total",
                )

    return (apartments, rows, breakdown), None


class BuildingViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = BuildingSerializer
    permission_classes = [IsAuthenticated]
    queryset = Building.objects.all().order_by("id")

    def update(self, request, *args, **kwargs):
        if request.user.role not in ("superadmin", "administrator"):
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        if request.user.role not in ("superadmin", "administrator"):
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        return super().partial_update(request, *args, **kwargs)


class ApartmentViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = ApartmentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        queryset = Apartment.objects.select_related("building")
        admin_actions = ("heating_factors", "designated_voter")
        if self.action in admin_actions and user.role in ("superadmin", "administrator"):
            return queryset.all().order_by("unit_code")
        all_scope = self.request.query_params.get("all")
        if self.action == "list" and all_scope in ("1", "true", "yes") and user.role in ("superadmin", "administrator"):
            return queryset.all().order_by("unit_code")
        return queryset.filter(memberships__user=user).distinct().order_by("unit_code")

    @action(methods=["patch"], detail=True, url_path="heating-factors")
    def heating_factors(self, request, pk=None):
        if request.user.role not in ("superadmin", "administrator"):
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        apartment = self.get_object()
        serializer = ApartmentHeatingFactorsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        apartment.heating_e_factor = serializer.validated_data["heating_e_factor"]
        apartment.heating_f_factor = serializer.validated_data["heating_f_factor"]
        apartment.save(update_fields=["heating_e_factor", "heating_f_factor", "updated_at"])
        return Response(ApartmentSerializer(apartment).data, status=status.HTTP_200_OK)

    @action(methods=["put"], detail=True, url_path="designated-voter")
    def designated_voter(self, request, pk=None):
        if request.user.role != "superadmin":
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        apartment = self.get_object()
        serializer = DesignatedVoterAssignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        voter_user_id = serializer.validated_data["voter_user_id"]
        is_member = ApartmentUser.objects.filter(apartment=apartment, user_id=voter_user_id).exists()
        if not is_member:
            return Response(
                {"detail": "Ο ορισμένος ψηφοφόρος πρέπει να είναι μέλος του διαμερίσματος."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        designated, _ = DesignatedVoter.objects.update_or_create(
            apartment=apartment,
            defaults={"voter_user_id": voter_user_id, "effective_from": timezone.now()},
        )
        return Response(
            {
                "apartment_id": apartment.id,
                "voter_user_id": designated.voter_user_id,
                "effective_from": designated.effective_from,
            },
            status=status.HTTP_200_OK,
        )


class AdminWriteRequiredMixin:
    def is_admin_write(self):
        return self.request.user.role in ("superadmin", "administrator")


def _visible_apartments_for_measurements(user):
    apartments = Apartment.objects.select_related("building")
    if user.role in ("superadmin", "administrator"):
        return apartments.order_by("unit_code")
    user_building_ids = ApartmentUser.objects.filter(user=user).values_list("apartment__building_id", flat=True)
    return apartments.filter(building_id__in=user_building_ids).distinct().order_by("unit_code")


def _measurement_date_locked(apartment_ids, measurement_date) -> bool:
    """A measurement date is locked for edits once its month has been used in an
    expense allocation, i.e. invoices have been generated for that month."""
    month = measurement_date.strftime("%Y-%m")
    return Invoice.objects.filter(month=month, apartment_id__in=apartment_ids).exists()


class HeatingMeasurementInputViewSet(AdminWriteRequiredMixin, viewsets.ModelViewSet):
    serializer_class = HeatingMeasurementInputSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        queryset = HeatingMeasurementInput.objects.select_related("apartment", "apartment__building").all()
        if user.role in ("superadmin", "administrator"):
            return queryset.order_by("-measurement_date", "apartment__unit_code")
        user_building_ids = ApartmentUser.objects.filter(user=user).values_list("apartment__building_id", flat=True)
        return queryset.filter(apartment__building_id__in=user_building_ids).distinct().order_by(
            "-measurement_date", "apartment__unit_code"
        )

    def create(self, request, *args, **kwargs):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    @action(methods=["delete"], detail=False, url_path="by-date")
    def delete_by_date(self, request):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)

        measurement_date_str = request.query_params.get("measurement_date")
        if not measurement_date_str:
            return Response({"detail": "Λείπει παράμετρος measurement_date."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            measurement_date = date.fromisoformat(measurement_date_str)
        except ValueError:
            return Response({"detail": "Μη έγκυρη ημερομηνία."}, status=status.HTTP_400_BAD_REQUEST)

        apartments = _visible_apartments_for_measurements(request.user)
        apartment_ids = list(apartments.values_list("id", flat=True))
        month = measurement_date.strftime("%Y-%m")

        if Invoice.objects.filter(month=month, apartment_id__in=apartment_ids, paid_total__gt=0).exists():
            return Response(
                {"detail": "Δεν επιτρέπεται διαγραφή· υπάρχουν λογαριασμοί του μήνα με καταχωρημένες πληρωμές."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        warnings = []
        if Invoice.objects.filter(month=month, apartment_id__in=apartment_ids).exists():
            warnings.append("Υπάρχουν εκδομένοι λογαριασμοί για τον μήνα χωρίς πληρωμές.")

        with transaction.atomic():
            heating_deleted, _ = HeatingMeasurementInput.objects.filter(
                apartment_id__in=apartment_ids,
                measurement_date=measurement_date,
            ).delete()
            water_deleted, _ = HeatedWaterMeasurementInput.objects.filter(
                apartment_id__in=apartment_ids,
                measurement_date=measurement_date,
            ).delete()

        return Response(
            {
                "detail": f"Οι μετρήσεις της ημερομηνίας {measurement_date} διαγράφηκαν.",
                "measurement_date": measurement_date.isoformat(),
                "heating_deleted": heating_deleted,
                "heated_water_deleted": water_deleted,
                "warnings": warnings,
            },
            status=status.HTTP_200_OK,
        )

    @action(methods=["get"], detail=False, url_path="dates")
    def dates(self, request):
        user = request.user
        apartments = _visible_apartments_for_measurements(user)
        apartment_ids = list(apartments.values_list("id", flat=True))

        heating_dates = set(
            HeatingMeasurementInput.objects.filter(apartment_id__in=apartment_ids).values_list("measurement_date", flat=True)
        )
        water_dates = set(
            HeatedWaterMeasurementInput.objects.filter(apartment_id__in=apartment_ids).values_list("measurement_date", flat=True)
        )
        measurement_dates = sorted(heating_dates | water_dates, reverse=True)

        items = []
        for measurement_date in measurement_dates:
            heating_count = HeatingMeasurementInput.objects.filter(
                apartment_id__in=apartment_ids, measurement_date=measurement_date
            ).count()
            water_count = HeatedWaterMeasurementInput.objects.filter(
                apartment_id__in=apartment_ids, measurement_date=measurement_date
            ).count()
            items.append(
                {
                    "measurement_date": measurement_date,
                    "heating_entries": heating_count,
                    "heated_water_entries": water_count,
                    "apartments_total": len(apartment_ids),
                    "locked": _measurement_date_locked(apartment_ids, measurement_date),
                }
            )

        suggested_date = date_after(measurement_dates[0]) if measurement_dates else timezone.now().date()

        return Response({"items": items, "suggested_next_date": suggested_date}, status=status.HTTP_200_OK)

    @action(methods=["get"], detail=False, url_path="entry-form")
    def entry_form(self, request):
        measurement_date = request.query_params.get("measurement_date")
        user = request.user
        apartments = _visible_apartments_for_measurements(user)

        all_dates = sorted(
            set(HeatingMeasurementInput.objects.filter(apartment__in=apartments).values_list("measurement_date", flat=True))
            | set(
                HeatedWaterMeasurementInput.objects.filter(apartment__in=apartments).values_list(
                    "measurement_date", flat=True
                )
            ),
            reverse=True,
        )
        if not measurement_date:
            measurement_date = date_after(all_dates[0]).isoformat() if all_dates else timezone.now().date().isoformat()

        rows = []
        for apartment in apartments:
            prev_heating = (
                HeatingMeasurementInput.objects.filter(apartment=apartment, measurement_date__lt=measurement_date)
                .order_by("-measurement_date")
                .first()
            )
            prev_water = (
                HeatedWaterMeasurementInput.objects.filter(apartment=apartment, measurement_date__lt=measurement_date)
                .order_by("-measurement_date")
                .first()
            )
            rows.append(
                {
                    "apartment_id": apartment.id,
                    "apartment_label": apartment.apartment_label,
                    "building_name": apartment.building.name,
                    "previous_heating_reading": str(prev_heating.current_reading if prev_heating else Decimal("0")),
                    "previous_heated_water_reading": str(prev_water.current_reading if prev_water else Decimal("0")),
                }
            )

        return Response({"measurement_date": measurement_date, "rows": rows}, status=status.HTTP_200_OK)

    @action(methods=["get"], detail=False, url_path="date-detail")
    def date_detail(self, request):
        measurement_date = request.query_params.get("measurement_date")
        if not measurement_date:
            return Response({"detail": "Λείπει παράμετρος measurement_date."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            measurement_date_obj = date.fromisoformat(measurement_date)
        except ValueError:
            return Response({"detail": "Μη έγκυρη ημερομηνία."}, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        apartments = _visible_apartments_for_measurements(user)
        apartment_ids = list(apartments.values_list("id", flat=True))

        heating_map = {
            item.apartment_id: item
            for item in HeatingMeasurementInput.objects.filter(apartment__in=apartments, measurement_date=measurement_date)
        }
        water_map = {
            item.apartment_id: item
            for item in HeatedWaterMeasurementInput.objects.filter(apartment__in=apartments, measurement_date=measurement_date)
        }

        rows = []
        for apartment in apartments:
            heating_item = heating_map.get(apartment.id)
            water_item = water_map.get(apartment.id)
            prev_heating = (
                HeatingMeasurementInput.objects.filter(apartment=apartment, measurement_date__lt=measurement_date)
                .order_by("-measurement_date")
                .first()
            )
            prev_water = (
                HeatedWaterMeasurementInput.objects.filter(apartment=apartment, measurement_date__lt=measurement_date)
                .order_by("-measurement_date")
                .first()
            )
            rows.append(
                {
                    "apartment_id": apartment.id,
                    "apartment_label": apartment.apartment_label,
                    "building_name": apartment.building.name,
                    "previous_heating_reading": str(prev_heating.current_reading if prev_heating else Decimal("0")),
                    "heating_current_reading": str(heating_item.current_reading if heating_item else ""),
                    "heating_units_counted": str(heating_item.units_counted if heating_item else ""),
                    "previous_heated_water_reading": str(prev_water.current_reading if prev_water else Decimal("0")),
                    "heated_water_current_reading": str(water_item.current_reading if water_item else ""),
                    "heated_water_units_counted": str(water_item.computed_heating_water_volume if water_item else ""),
                }
            )
        return Response(
            {
                "measurement_date": measurement_date,
                "locked": _measurement_date_locked(apartment_ids, measurement_date_obj),
                "rows": rows,
            },
            status=status.HTTP_200_OK,
        )

    @action(methods=["post"], detail=False, url_path="monthly-upsert")
    def monthly_upsert(self, request):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)

        input_serializer = MonthlyMeasurementUpsertSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data
        rows = data["rows"]
        apartment_ids = {row["apartment_id"] for row in rows}
        apartments = {
            apartment.id: apartment
            for apartment in Apartment.objects.filter(id__in=apartment_ids).select_related("building")
        }

        missing_ids = sorted(list(apartment_ids - set(apartments.keys())))
        if missing_ids:
            return Response(
                {"detail": f"Μη έγκυρα αναγνωριστικά διαμερισμάτων: {missing_ids}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if _measurement_date_locked(apartment_ids, data["measurement_date"]):
            return Response(
                {
                    "detail": "Δεν επιτρέπεται επεξεργασία· οι μετρήσεις του μήνα έχουν χρησιμοποιηθεί σε "
                    "κατανομή εξόδων (υπάρχουν λογαριασμοί). Ανακαλέστε πρώτα τους λογαριασμούς του μήνα."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        missing_factors = [
            apt.apartment_label
            for apt in apartments.values()
            if apt.heating_e_factor is None or apt.heating_f_factor is None
        ]
        if missing_factors:
            return Response(
                {"detail": f"Λείπουν συντελεστές θέρμανσης διαμερισμάτων (e/f): {', '.join(sorted(missing_factors))}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        created_count = 0
        updated_count = 0
        with transaction.atomic():
            for row in rows:
                apartment = apartments[row["apartment_id"]]
                e = Decimal(apartment.heating_e_factor)
                f = Decimal(apartment.heating_f_factor)

                prev_heating = (
                    HeatingMeasurementInput.objects.filter(
                        apartment=apartment, measurement_date__lt=data["measurement_date"]
                    )
                    .order_by("-measurement_date")
                    .first()
                )
                prev_heating_reading = Decimal(prev_heating.current_reading) if prev_heating else Decimal("0")
                current_heating_reading = q1(Decimal(row["heating_current_reading"]))
                heating_units = q1(current_heating_reading - prev_heating_reading)
                if heating_units < Decimal("0"):
                    return Response(
                        {"detail": f"Αρνητική κατανάλωση θέρμανσης στο διαμέρισμα {apartment.apartment_label}."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                prev_water = (
                    HeatedWaterMeasurementInput.objects.filter(
                        apartment=apartment, measurement_date__lt=data["measurement_date"]
                    )
                    .order_by("-measurement_date")
                    .first()
                )
                prev_water_reading = Decimal(prev_water.current_reading) if prev_water else Decimal("0")
                current_water_reading = q1(Decimal(row["heated_water_current_reading"]))
                water_units = q1(current_water_reading - prev_water_reading)
                if water_units < Decimal("0"):
                    return Response(
                        {"detail": f"Αρνητική κατανάλωση θερμού νερού στο διαμέρισμα {apartment.apartment_label}."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                heating_defaults = {
                    "e_factor": e,
                    "f_factor": f,
                    "current_reading": current_heating_reading,
                    "units_counted": heating_units,
                    "computed_radiator_heating_energy": e * f,
                    "created_by_user": request.user,
                }
                _, heating_created = HeatingMeasurementInput.objects.update_or_create(
                    apartment=apartment,
                    measurement_date=data["measurement_date"],
                    defaults=heating_defaults,
                )

                water_defaults = {
                    "current_reading": current_water_reading,
                    "computed_heating_water_volume": water_units,
                    "created_by_user": request.user,
                }
                _, water_created = HeatedWaterMeasurementInput.objects.update_or_create(
                    apartment=apartment,
                    measurement_date=data["measurement_date"],
                    defaults=water_defaults,
                )
                if heating_created and water_created:
                    created_count += 1
                else:
                    updated_count += 1

        return Response(
            {
                "detail": f"Οι μετρήσεις αποθηκεύτηκαν για την ημερομηνία {data['measurement_date']}.",
                "created": created_count,
                "updated": updated_count,
                "rows": len(rows),
            },
            status=status.HTTP_200_OK,
        )

    @action(methods=["post"], detail=False, url_path="bulk-upsert")
    def bulk_upsert(self, request):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)

        input_serializer = HeatingBulkUpsertSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data
        rows = data["rows"]
        apartment_ids = {row["apartment_id"] for row in rows}
        apartments = {
            apartment.id: apartment
            for apartment in Apartment.objects.filter(id__in=apartment_ids).select_related("building")
        }
        missing_ids = sorted(list(apartment_ids - set(apartments.keys())))
        if missing_ids:
            return Response(
                {"detail": f"Μη έγκυρα αναγνωριστικά διαμερισμάτων: {missing_ids}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        missing_factors = [
            apt.apartment_label
            for apt in apartments.values()
            if apt.heating_e_factor is None or apt.heating_f_factor is None
        ]
        if missing_factors:
            return Response(
                {"detail": f"Λείπουν συντελεστές θέρμανσης διαμερισμάτων (e/f): {', '.join(sorted(missing_factors))}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        created_count = 0
        updated_count = 0
        with transaction.atomic():
            for row in rows:
                apartment = apartments[row["apartment_id"]]
                e = Decimal(apartment.heating_e_factor)
                f = Decimal(apartment.heating_f_factor)
                defaults = {
                    "e_factor": e,
                    "f_factor": f,
                    "units_counted": q1(Decimal(row["units_counted"])),
                    "computed_radiator_heating_energy": e * f,
                    "created_by_user": request.user,
                }
                _, created = HeatingMeasurementInput.objects.update_or_create(
                    apartment=apartment,
                    measurement_date=data["measurement_date"],
                    defaults=defaults,
                )
                if created:
                    created_count += 1
                else:
                    updated_count += 1

        return Response(
            {
                "detail": f"Οι μετρήσεις θέρμανσης αποθηκεύτηκαν για την ημερομηνία {data['measurement_date']}.",
                "created": created_count,
                "updated": updated_count,
                "rows": len(rows),
            },
            status=status.HTTP_200_OK,
        )


class HeatedWaterMeasurementInputViewSet(AdminWriteRequiredMixin, viewsets.ModelViewSet):
    serializer_class = HeatedWaterMeasurementInputSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        queryset = HeatedWaterMeasurementInput.objects.select_related("apartment", "apartment__building").all()
        if user.role in ("superadmin", "administrator"):
            return queryset.order_by("-measurement_date", "apartment__unit_code")
        user_building_ids = ApartmentUser.objects.filter(user=user).values_list("apartment__building_id", flat=True)
        return queryset.filter(apartment__building_id__in=user_building_ids).distinct().order_by(
            "-measurement_date", "apartment__unit_code"
        )

    def create(self, request, *args, **kwargs):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    @action(methods=["post"], detail=False, url_path="bulk-upsert")
    def bulk_upsert(self, request):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)

        input_serializer = HeatedWaterBulkUpsertSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data
        rows = data["rows"]
        apartment_ids = {row["apartment_id"] for row in rows}
        apartments = {
            apartment.id: apartment
            for apartment in Apartment.objects.filter(id__in=apartment_ids).select_related("building")
        }
        missing_ids = sorted(list(apartment_ids - set(apartments.keys())))
        if missing_ids:
            return Response(
                {"detail": f"Μη έγκυρα αναγνωριστικά διαμερισμάτων: {missing_ids}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        created_count = 0
        updated_count = 0
        with transaction.atomic():
            for row in rows:
                apartment = apartments[row["apartment_id"]]
                defaults = {
                    "inputs_json": row.get("inputs_json", {}),
                    "computed_heating_water_volume": q1(Decimal(row["computed_heating_water_volume"])),
                    "created_by_user": request.user,
                }
                _, created = HeatedWaterMeasurementInput.objects.update_or_create(
                    apartment=apartment,
                    measurement_date=data["measurement_date"],
                    defaults=defaults,
                )
                if created:
                    created_count += 1
                else:
                    updated_count += 1

        return Response(
            {
                "detail": f"Οι μετρήσεις θερμού νερού αποθηκεύτηκαν για την ημερομηνία {data['measurement_date']}.",
                "created": created_count,
                "updated": updated_count,
                "rows": len(rows),
            },
            status=status.HTTP_200_OK,
        )


class ExpenseItemViewSet(AdminWriteRequiredMixin, viewsets.ModelViewSet):
    serializer_class = ExpenseItemSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        queryset = ExpenseItem.objects.select_related("building").all()
        month = self.request.query_params.get("month")
        if month:
            queryset = queryset.filter(month=month)
        if user.role in ("superadmin", "administrator"):
            return queryset.order_by("-expense_date", "id")
        allowed_building_ids = Apartment.objects.filter(memberships__user=user).values_list("building_id", flat=True).distinct()
        return queryset.filter(building_id__in=allowed_building_ids).order_by("-expense_date", "id")

    def create(self, request, *args, **kwargs):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            expense = serializer.save()
            if expense.expense_category == ExpenseItem.Category.FUND_INCREASE:
                _adjust_building_fund_balance(expense.building_id, Decimal(expense.amount))
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def update(self, request, *args, **kwargs):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        old_building_id = instance.building_id
        old_category = instance.expense_category
        old_amount = Decimal(instance.amount)
        with transaction.atomic():
            expense = serializer.save()
            _reconcile_fund_increase_expense(
                old_building_id=old_building_id,
                old_category=old_category,
                old_amount=old_amount,
                new_building_id=expense.building_id,
                new_category=expense.expense_category,
                new_amount=Decimal(expense.amount),
            )
        return Response(serializer.data)

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        instance = self.get_object()
        with transaction.atomic():
            if instance.expense_category == ExpenseItem.Category.FUND_INCREASE:
                _adjust_building_fund_balance(instance.building_id, -Decimal(instance.amount))
            instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class InvoiceViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = InvoiceSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        queryset = Invoice.objects.select_related("apartment", "apartment__building").all()
        month = self.request.query_params.get("month")
        building_scope = self.request.query_params.get("building_scope")
        personal_scope = self.request.query_params.get("personal_scope")
        if month:
            queryset = queryset.filter(month=month)
        if personal_scope in ("1", "true", "yes"):
            return queryset.filter(apartment__memberships__user=user).distinct().order_by("-month", "apartment__unit_code")
        if user.role in ("superadmin", "administrator"):
            return queryset.order_by("-month", "apartment__unit_code")
        if building_scope in ("1", "true", "yes"):
            user_building_ids = ApartmentUser.objects.filter(user=user).values_list("apartment__building_id", flat=True)
            return (
                queryset.filter(apartment__building_id__in=user_building_ids)
                .distinct()
                .order_by("-month", "apartment__unit_code")
            )
        return queryset.filter(apartment__memberships__user=user).distinct().order_by("-month", "apartment__unit_code")

    @action(methods=["get"], detail=False, url_path="preview")
    def preview(self, request):
        if request.user.role not in ("superadmin", "administrator"):
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)

        month = request.query_params.get("month")
        if not month:
            return Response({"detail": "Λείπει παράμετρος month."}, status=status.HTTP_400_BAD_REQUEST)

        input_serializer = InvoiceGenerateSerializer(data={"month": month})
        input_serializer.is_valid(raise_exception=True)
        month = input_serializer.validated_data["month"]

        result, error = _calculate_invoice_rows(month)
        if error:
            return Response(error, status=status.HTTP_400_BAD_REQUEST)
        apartments, rows, _breakdown = result
        existing_invoices = {
            invoice.apartment_id: invoice for invoice in Invoice.objects.filter(month=month)
        }

        preview_items = []
        for apartment in apartments:
            preview_items.append(
                _build_preview_invoice_item(
                    apartment,
                    month,
                    rows[apartment.id],
                    existing_invoices.get(apartment.id),
                )
            )

        warnings = _invoice_generation_warnings(month, apartments, rows)
        return Response({"month": month, "items": preview_items, "warnings": warnings}, status=status.HTTP_200_OK)

    @action(methods=["get"], detail=False, url_path="analysis-share")
    def analysis_share(self, request):
        month = request.query_params.get("month")
        if not month:
            return Response({"detail": "Λείπει παράμετρος month."}, status=status.HTTP_400_BAD_REQUEST)

        all_month_invoices = (
            Invoice.objects.select_related("apartment")
            .filter(month=month)
            .order_by("apartment__unit_code")
        )
        total = sum((invoice.invoice_total for invoice in all_month_invoices), Decimal("0.00"))
        items = []
        for invoice in all_month_invoices:
            invoice_total = Decimal(invoice.invoice_total or Decimal("0.00"))
            share_percent = Decimal("0.00")
            if total > 0:
                share_percent = q2((invoice_total * Decimal("100.00")) / total)
            items.append(
                {
                    "invoice_id": invoice.id,
                    "apartment_id": invoice.apartment_id,
                    "apartment_unit_code": invoice.apartment.unit_code,
                    "invoice_total": q2(invoice_total),
                    "share_percent": share_percent,
                }
            )

        return Response(
            {
                "month": month,
                "total_invoice_amount": q2(total),
                "items": items,
            },
            status=status.HTTP_200_OK,
        )

    @action(methods=["post"], detail=False, url_path="generate")
    def generate(self, request):
        if request.user.role not in ("superadmin", "administrator"):
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)

        input_serializer = InvoiceGenerateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        month = input_serializer.validated_data["month"]
        result, error = _calculate_invoice_rows(month)
        if error:
            return Response(error, status=status.HTTP_400_BAD_REQUEST)
        apartments, rows, _breakdown = result
        valid_apartment_ids = {apartment.id for apartment in apartments}
        adjustments_provided = "adjustments" in request.data
        adjustments_map = (
            _parse_invoice_adjustments(request.data.get("adjustments"), valid_apartment_ids)
            if adjustments_provided
            else {}
        )
        existing_invoices = {
            invoice.apartment_id: invoice for invoice in Invoice.objects.filter(month=month)
        }

        with transaction.atomic():
            created_count = 0
            updated_count = 0
            for apartment in apartments:
                data = rows[apartment.id]
                computed_total = _computed_invoice_total(data)
                existing_invoice = existing_invoices.get(apartment.id)
                custom_adjustment, custom_note = _resolve_invoice_adjustment(
                    apartment.id,
                    adjustments_provided=adjustments_provided,
                    adjustments_map=adjustments_map,
                    existing_invoice=existing_invoice,
                )
                invoice_total = q2(computed_total + custom_adjustment)

                invoice, created = Invoice.objects.get_or_create(apartment=apartment, month=month)
                if created:
                    created_count += 1
                else:
                    updated_count += 1
                invoice.heating_radiators_total = q2(data["heating_radiators_total"])
                invoice.heated_water_energy_total = q2(data["heated_water_energy_total"])
                invoice.water_consumption_total = q2(data["water_consumption_total"])
                invoice.common_recurring_total = q2(data["common_recurring_total"])
                invoice.common_non_recurring_total = q2(data["common_non_recurring_total"])
                invoice.owners_only_total = q2(data["owners_only_total"])
                invoice.custom_adjustment = custom_adjustment
                invoice.custom_adjustment_note = custom_note
                invoice.invoice_total = invoice_total
                if invoice.paid_total > invoice_total:
                    invoice.paid_total = invoice_total
                invoice.outstanding_balance = q2(invoice.invoice_total - invoice.paid_total)
                invoice.status = Invoice.Status.ISSUED
                invoice.issued_at = timezone.now()
                invoice.save()

        warnings = _invoice_generation_warnings(month, apartments, rows)
        return Response(
            {
                "detail": f"Οι λογαριασμοί δημιουργήθηκαν για τον μήνα {month}.",
                "month": month,
                "created": created_count,
                "updated": updated_count,
                "warnings": warnings,
            },
            status=status.HTTP_200_OK,
        )

    @action(methods=["post"], detail=False, url_path="send-monthly-invoices")
    def send_monthly_invoices(self, request):
        if request.user.role not in ("superadmin", "administrator"):
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)

        input_serializer = InvoiceGenerateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        month = input_serializer.validated_data["month"]
        force = bool(request.data.get("force", False))

        invoices = list(
            Invoice.objects.select_related("apartment")
            .filter(month=month, status__in=[Invoice.Status.ISSUED, Invoice.Status.PAID])
            .order_by("apartment__unit_code")
        )
        if not invoices:
            return Response({"detail": "Δεν βρέθηκαν εκδομένοι λογαριασμοί για τον μήνα."}, status=status.HTTP_400_BAD_REQUEST)

        sent = 0
        failed = 0
        skipped = 0
        for invoice in invoices:
            existing_doc = (
                invoice.documents.filter(document_type=InvoiceDocument.DocumentType.INVOICE, payment__isnull=True)
                .order_by("-created_at")
                .first()
            )
            if existing_doc:
                invoice_filename = existing_doc.file_name
                invoice_pdf = bytes(existing_doc.content)
            else:
                invoice_filename, invoice_pdf = _create_invoice_pdf(invoice)
                InvoiceDocument.objects.create(
                    invoice=invoice,
                    payment=None,
                    document_type=InvoiceDocument.DocumentType.INVOICE,
                    file_name=invoice_filename,
                    mime_type="application/pdf",
                    content=invoice_pdf,
                )

            dispatch = _send_invoice_email(invoice, invoice_filename, invoice_pdf, force=force)
            if dispatch.status == NotificationDispatch.Status.SENT:
                sent += 1
            elif dispatch.status == NotificationDispatch.Status.FAILED:
                failed += 1
            else:
                skipped += 1

        return Response(
            {
                "detail": "Η αποστολή μηνιαίων λογαριασμών ολοκληρώθηκε.",
                "month": month,
                "total": len(invoices),
                "sent": sent,
                "failed": failed,
                "skipped": skipped,
            },
            status=status.HTTP_200_OK,
        )

    @action(methods=["post"], detail=False, url_path="retry-failed-notifications")
    def retry_failed_notifications(self, request):
        if request.user.role not in ("superadmin", "administrator"):
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)

        month = request.data.get("month")
        notification_type = request.data.get("notification_type")
        dispatch_id = request.data.get("dispatch_id")
        dispatches = NotificationDispatch.objects.select_related("invoice", "payment", "invoice__apartment").filter(
            status=NotificationDispatch.Status.FAILED
        )
        if month:
            dispatches = dispatches.filter(invoice__month=month)
        if notification_type:
            dispatches = dispatches.filter(notification_type=notification_type)
        if dispatch_id:
            dispatches = dispatches.filter(id=dispatch_id)
        dispatches = list(dispatches.order_by("created_at"))

        sent = 0
        failed = 0
        skipped = 0
        retried = 0

        for dispatch in dispatches:
            retried += 1
            invoice = dispatch.invoice
            if dispatch.notification_type == NotificationDispatch.NotificationType.RECEIPT_PAID:
                payment = dispatch.payment or invoice.payments.order_by("-created_at").first()
                if not payment:
                    skipped += 1
                    continue
                doc = (
                    invoice.documents.filter(payment=payment, document_type=InvoiceDocument.DocumentType.RECEIPT)
                    .order_by("-created_at")
                    .first()
                )
                if doc:
                    receipt_filename = doc.file_name
                    receipt_pdf = bytes(doc.content)
                else:
                    receipt_filename, receipt_pdf = _create_receipt_pdf(invoice, payment)
                    InvoiceDocument.objects.create(
                        invoice=invoice,
                        payment=payment,
                        document_type=InvoiceDocument.DocumentType.RECEIPT,
                        file_name=receipt_filename,
                        mime_type="application/pdf",
                        content=receipt_pdf,
                    )
                retried_dispatch = _send_receipt_email(invoice, payment, receipt_filename, receipt_pdf, force=True)
            elif dispatch.notification_type == NotificationDispatch.NotificationType.INVOICE_MONTHLY:
                invoice_doc = (
                    invoice.documents.filter(document_type=InvoiceDocument.DocumentType.INVOICE, payment__isnull=True)
                    .order_by("-created_at")
                    .first()
                )
                if invoice_doc:
                    invoice_filename = invoice_doc.file_name
                    invoice_pdf = bytes(invoice_doc.content)
                else:
                    invoice_filename, invoice_pdf = _create_invoice_pdf(invoice)
                    InvoiceDocument.objects.create(
                        invoice=invoice,
                        payment=None,
                        document_type=InvoiceDocument.DocumentType.INVOICE,
                        file_name=invoice_filename,
                        mime_type="application/pdf",
                        content=invoice_pdf,
                    )
                retried_dispatch = _send_invoice_email(invoice, invoice_filename, invoice_pdf, force=True)
            else:
                skipped += 1
                continue

            if retried_dispatch.status == NotificationDispatch.Status.SENT:
                sent += 1
            elif retried_dispatch.status == NotificationDispatch.Status.FAILED:
                failed += 1
            else:
                skipped += 1

        return Response(
            {
                "detail": "Ο επανέλεγχος αποτυχημένων ειδοποιήσεων ολοκληρώθηκε.",
                "month": month or "",
                "retried": retried,
                "sent": sent,
                "failed": failed,
                "skipped": skipped,
            },
            status=status.HTTP_200_OK,
        )

    @action(methods=["post"], detail=True, url_path="mark-paid")
    def mark_paid(self, request, pk=None):
        if request.user.role not in ("superadmin", "administrator"):
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        invoice = self.get_object()
        serializer = InvoiceMarkPaidSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        if invoice.outstanding_balance <= Decimal("0"):
            return Response({"detail": "Ο λογαριασμός είναι ήδη εξοφλημένος."}, status=status.HTTP_400_BAD_REQUEST)

        payment_amount = data.get("amount", invoice.outstanding_balance)
        payment_date = data.get("payment_date", timezone.now().date())
        if payment_amount <= Decimal("0"):
            return Response({"detail": "Το ποσό πληρωμής πρέπει να είναι θετικό."}, status=status.HTTP_400_BAD_REQUEST)
        if payment_amount > invoice.outstanding_balance:
            return Response({"detail": "Το ποσό πληρωμής δεν μπορεί να υπερβαίνει το υπόλοιπο."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            payment = PaymentRecord.objects.create(
                invoice=invoice,
                apartment=invoice.apartment,
                amount=q2(Decimal(payment_amount)),
                payment_date=payment_date,
                method=data.get("method", PaymentRecord.Method.BANK_TRANSFER),
                reference=data.get("reference", ""),
                notes=data.get("notes", ""),
                created_by_user=request.user,
            )
            invoice.paid_total = q2(Decimal(invoice.paid_total) + Decimal(payment.amount))
            invoice.outstanding_balance = q2(Decimal(invoice.invoice_total) - Decimal(invoice.paid_total))
            invoice.status = Invoice.Status.PAID if invoice.outstanding_balance <= Decimal("0") else Invoice.Status.ISSUED
            invoice.save(update_fields=["paid_total", "outstanding_balance", "status", "updated_at"])

            receipt_filename, receipt_pdf = _create_receipt_pdf(invoice, payment)
            document = InvoiceDocument.objects.create(
                invoice=invoice,
                payment=payment,
                document_type=InvoiceDocument.DocumentType.RECEIPT,
                file_name=receipt_filename,
                mime_type="application/pdf",
                content=receipt_pdf,
            )
            dispatch = _send_receipt_email(invoice, payment, receipt_filename, receipt_pdf)

        return Response(
            {
                "detail": "Η πληρωμή καταχωρίστηκε και δημιουργήθηκε απόδειξη.",
                "invoice": InvoiceSerializer(invoice).data,
                "payment": PaymentRecordSerializer(payment).data,
                "receipt_document_id": document.id,
                "notification_status": dispatch.status if dispatch else NotificationDispatch.Status.SENT,
            },
            status=status.HTTP_200_OK,
        )

    @action(methods=["post"], detail=True, url_path="send-receipt")
    def send_receipt(self, request, pk=None):
        if request.user.role not in ("superadmin", "administrator"):
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        invoice = self.get_object()
        payment_id = request.data.get("payment_id")
        force = bool(request.data.get("force", False))

        payments = invoice.payments.order_by("-created_at")
        if payment_id:
            payments = payments.filter(id=payment_id)
        payment = payments.first()
        if not payment:
            return Response({"detail": "Δεν βρέθηκε πληρωμή για αποστολή απόδειξης."}, status=status.HTTP_400_BAD_REQUEST)

        doc = (
            invoice.documents.filter(payment=payment, document_type=InvoiceDocument.DocumentType.RECEIPT)
            .order_by("-created_at")
            .first()
        )
        if doc:
            receipt_filename = doc.file_name
            receipt_pdf = bytes(doc.content)
        else:
            receipt_filename, receipt_pdf = _create_receipt_pdf(invoice, payment)
            InvoiceDocument.objects.create(
                invoice=invoice,
                payment=payment,
                document_type=InvoiceDocument.DocumentType.RECEIPT,
                file_name=receipt_filename,
                mime_type="application/pdf",
                content=receipt_pdf,
            )

        dispatch = _send_receipt_email(invoice, payment, receipt_filename, receipt_pdf, force=force)
        if dispatch is None:
            return Response(
                {"detail": "Η απόδειξη έχει ήδη σταλεί. Χρησιμοποιήστε force=true για επαναποστολή."},
                status=status.HTTP_409_CONFLICT,
            )
        return Response({"detail": "Η αποστολή απόδειξης ολοκληρώθηκε.", "notification_status": dispatch.status})

    @action(methods=["get"], detail=True, url_path="download-pdf")
    def download_pdf(self, request, pk=None):
        invoice = self.get_object()
        filename, invoice_pdf = _create_invoice_pdf(invoice)
        response = HttpResponse(invoice_pdf, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    @action(methods=["get"], detail=True, url_path="download-receipt")
    def download_receipt(self, request, pk=None):
        invoice = self.get_object()
        payment = invoice.payments.order_by("-created_at").first()
        if not payment:
            return Response({"detail": "Δεν βρέθηκε απόδειξη για αυτόν τον λογαριασμό."}, status=status.HTTP_404_NOT_FOUND)

        receipt_filename, receipt_pdf = _create_receipt_pdf(invoice, payment)
        InvoiceDocument.objects.create(
            invoice=invoice,
            payment=payment,
            document_type=InvoiceDocument.DocumentType.RECEIPT,
            file_name=receipt_filename,
            mime_type="application/pdf",
            content=receipt_pdf,
        )

        response = HttpResponse(receipt_pdf, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{receipt_filename}"'
        return response

    @action(methods=["post"], detail=False, url_path="recall-month")
    def recall_month(self, request):
        if request.user.role not in ("superadmin", "administrator"):
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        month = request.data.get("month")
        if not month:
            return Response({"detail": "Λείπει παράμετρος month."}, status=status.HTTP_400_BAD_REQUEST)
        if not request.data.get("confirm"):
            return Response({"detail": "Απαιτείται επιβεβαίωση (confirm=true)."}, status=status.HTTP_400_BAD_REQUEST)

        invoices = Invoice.objects.filter(month=month)
        invoices_count = invoices.count()
        if not invoices_count:
            return Response(
                {"detail": "Δεν βρέθηκαν λογαριασμοί για τον μήνα."},
                status=status.HTTP_404_NOT_FOUND,
            )
        payments_count = PaymentRecord.objects.filter(invoice__month=month).count()
        documents_count = InvoiceDocument.objects.filter(invoice__month=month).count()
        with transaction.atomic():
            invoices.delete()

        return Response(
            {
                "detail": f"Ανακλήθηκαν {invoices_count} λογαριασμοί για τον μήνα {month}.",
                "month": month,
                "invoices_deleted": invoices_count,
                "payments_deleted": payments_count,
                "documents_deleted": documents_count,
            },
            status=status.HTTP_200_OK,
        )


class PaymentRecordViewSet(
    AdminWriteRequiredMixin,
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = PaymentRecordSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        queryset = PaymentRecord.objects.select_related("invoice", "apartment", "apartment__building").all()
        month = self.request.query_params.get("month")
        if month:
            queryset = queryset.filter(invoice__month=month)
        if user.role in ("superadmin", "administrator"):
            return queryset.order_by("-payment_date", "-id")
        return queryset.filter(apartment__memberships__user=user).distinct().order_by("-payment_date", "-id")

    def create(self, request, *args, **kwargs):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        invoice = serializer.validated_data["invoice"]
        if invoice.outstanding_balance <= Decimal("0"):
            return Response({"detail": "Ο λογαριασμός είναι ήδη εξοφλημένος."}, status=status.HTTP_400_BAD_REQUEST)
        amount = Decimal(serializer.validated_data["amount"])
        if amount > Decimal(invoice.outstanding_balance):
            return Response({"detail": "Το ποσό πληρωμής δεν μπορεί να υπερβαίνει το υπόλοιπο."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            payment = serializer.save()
            invoice.paid_total = q2(Decimal(invoice.paid_total) + Decimal(payment.amount))
            invoice.outstanding_balance = q2(Decimal(invoice.invoice_total) - Decimal(invoice.paid_total))
            invoice.status = Invoice.Status.PAID if invoice.outstanding_balance <= Decimal("0") else Invoice.Status.ISSUED
            invoice.save(update_fields=["paid_total", "outstanding_balance", "status", "updated_at"])

            receipt_filename, receipt_pdf = _create_receipt_pdf(invoice, payment)
            InvoiceDocument.objects.create(
                invoice=invoice,
                payment=payment,
                document_type=InvoiceDocument.DocumentType.RECEIPT,
                file_name=receipt_filename,
                mime_type="application/pdf",
                content=receipt_pdf,
            )
            dispatch = _send_receipt_email(invoice, payment, receipt_filename, receipt_pdf)

        response_data = self.get_serializer(payment).data
        response_data["notification_status"] = dispatch.status if dispatch else NotificationDispatch.Status.SENT
        return Response(response_data, status=status.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)

        payment = self.get_object()
        with transaction.atomic():
            invoice = payment.invoice
            InvoiceDocument.objects.filter(payment=payment).delete()
            payment.delete()
            _recalculate_invoice_settlement(invoice)

        return Response(status=status.HTTP_204_NO_CONTENT)


class VoteSessionViewSet(viewsets.ModelViewSet):
    serializer_class = VoteSessionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        queryset = VoteSession.objects.select_related("building", "created_by_user").all()
        if user.role in ("superadmin", "administrator"):
            return queryset.order_by("-start_at", "-id")
        building_ids = ApartmentUser.objects.filter(user=user).values_list("apartment__building_id", flat=True).distinct()
        return queryset.filter(building_id__in=building_ids).distinct().order_by("-start_at", "-id")

    def create(self, request, *args, **kwargs):
        if request.user.role not in ("superadmin", "administrator"):
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        if request.user.role not in ("superadmin", "administrator"):
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        if request.user.role not in ("superadmin", "administrator"):
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if request.user.role not in ("superadmin", "administrator"):
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    @action(methods=["get", "post"], detail=True, url_path="votes")
    def votes(self, request, pk=None):
        session = self.get_object()
        if request.method == "GET":
            queryset = Vote.objects.select_related("apartment", "voter_user").filter(vote_session=session)
            if request.user.role not in ("superadmin", "administrator"):
                apartment_ids = ApartmentUser.objects.filter(user=request.user).values_list("apartment_id", flat=True)
                queryset = queryset.filter(apartment_id__in=apartment_ids)
            serializer = VoteSerializer(queryset.order_by("apartment__unit_code"), many=True)
            return Response({"items": serializer.data}, status=status.HTTP_200_OK)

        now = timezone.now()
        if session.status != VoteSession.Status.ACTIVE:
            return Response({"detail": "Η ψηφοφορία δεν είναι ενεργή."}, status=status.HTTP_400_BAD_REQUEST)
        if now < session.start_at or now > session.end_at:
            return Response({"detail": "Η ψηφοφορία είναι εκτός ενεργού χρονικού διαστήματος."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = VoteSubmitSerializer(data=request.data, context={"request": request, "vote_session": session})
        serializer.is_valid(raise_exception=True)
        apartment = Apartment.objects.get(id=serializer.validated_data["apartment_id"])
        designated = DesignatedVoter.objects.filter(apartment=apartment, voter_user=request.user).exists()
        if not designated:
            return Response(
                {"detail": "Μόνο ο ορισμένος ψηφοφόρος μπορεί να ψηφίσει για το συγκεκριμένο διαμέρισμα."},
                status=status.HTTP_403_FORBIDDEN,
            )

        existing_vote = Vote.objects.filter(vote_session=session, apartment=apartment).first()
        if existing_vote:
            return Response(
                {"detail": "Το διαμέρισμα έχει ήδη ψηφίσει. Η ψήφος είναι οριστική."},
                status=status.HTTP_409_CONFLICT,
            )

        vote = Vote.objects.create(
            vote_session=session,
            apartment=apartment,
            voter_user=request.user,
            vote_value=serializer.validated_data["vote_value"],
        )
        vote_serializer = VoteSerializer(vote)
        return Response(
            {
                "detail": "Η ψήφος καταχωρίστηκε.",
                "item": vote_serializer.data,
                "updated": False,
            },
            status=status.HTTP_200_OK,
        )

    @action(methods=["get"], detail=True, url_path="results")
    def results(self, request, pk=None):
        session = self.get_object()
        all_votes = Vote.objects.select_related("apartment").filter(vote_session=session)
        options = session.vote_options_json or [Vote.Value.YES, Vote.Value.NO, Vote.Value.ABSTAIN]
        counts: dict[str, int] = {str(option): 0 for option in options}
        permille_by_option: dict[str, Decimal] = {str(option): Decimal("0.000") for option in options}

        total_votes = 0
        for vote in all_votes:
            option = str(vote.vote_value)
            counts[option] = counts.get(option, 0) + 1
            permille_by_option[option] = permille_by_option.get(option, Decimal("0.000")) + Decimal(vote.apartment.ownership_permille)
            total_votes += 1

        eligible_apartments_qs = Apartment.objects.filter(building=session.building)
        eligible_apartments = eligible_apartments_qs.count()
        total_eligible_permille = sum(
            (Decimal(permille) for permille in eligible_apartments_qs.values_list("ownership_permille", flat=True)),
            Decimal("0.000"),
        )
        submitted_permille = sum(permille_by_option.values(), Decimal("0.000"))

        return Response(
            {
                "session_id": session.id,
                "title": session.title,
                "session_type": session.session_type,
                "vote_options": options,
                "eligible_apartments": eligible_apartments,
                "submitted_votes": total_votes,
                "counts": counts,
                "permille": {
                    **{option: q1(value) for option, value in permille_by_option.items()},
                    "submitted_total": q1(submitted_permille),
                    "eligible_total": q1(total_eligible_permille),
                },
            },
            status=status.HTTP_200_OK,
        )
